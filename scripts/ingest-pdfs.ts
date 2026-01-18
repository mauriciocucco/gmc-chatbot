import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// pdf-parse v2: se usa como clase (new PDFParse({ data })) y luego getText().
interface PdfParseTextResult {
  text: string;
}

interface PdfParseInstance {
  getText(): Promise<PdfParseTextResult>;
  destroy(): Promise<void>;
}

interface PdfParseConstructor {
  new (options: { data: Buffer }): PdfParseInstance;
}

async function loadPdfParseConstructor(): Promise<PdfParseConstructor> {
  const module = (await import('pdf-parse')) as unknown as {
    PDFParse: PdfParseConstructor;
  };
  return module.PDFParse;
}

const API_URL = 'http://localhost:3000/knowledge/add-entry';
const EXISTS_URL = 'http://localhost:3000/knowledge/exists';
const DOCS_DIR = path.join(__dirname, '../docs');

type Source = 'manual_pba' | 'cnev_nacional' | 'bateria_preguntas';
type Priority = 'alta' | 'media' | 'baja';

interface FileInfo {
  name: string;
  source: Source;
  priority: Priority;
  description: string;
}

const FILES: FileInfo[] = [
  {
    name: 'manual_pba.pdf',
    source: 'manual_pba',
    priority: 'media',
    description: 'Manual Oficial Provincia BSAS',
  },
  {
    name: 'cnev_autos.pdf',
    source: 'cnev_nacional',
    priority: 'media',
    description: 'Ley Nacional de Tránsito (CNEV)',
  },
  {
    name: 'preguntas_examen.pdf',
    source: 'bateria_preguntas',
    priority: 'alta',
    description: 'Batería de Preguntas Examen',
  },
];

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const enabledSources = new Set<Source>(
  parseCsvEnv(process.env.INGEST_SOURCES) as Source[],
);

const enabledFiles = new Set<string>(parseCsvEnv(process.env.INGEST_FILES));

function cleanRawText(text: string): string {
  return (
    text
      // 0. Eliminar bytes nulos (PostgreSQL no los acepta en UTF-8)
      // eslint-disable-next-line no-control-regex
      .replace(/\x00/g, '')

      // 1. Normalizar caracteres de encoding roto
      .replace(/\uFFFD/g, '')
      .replace(/[•·●○■□▪▫]/g, '-')

      // 2. Unir palabras cortadas por guiones al final de línea
      .replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2')

      // 3. Eliminar líneas que sean solo números (número de página)
      .replace(/^\s*\d+\s*$/gm, '')

      // 4. Eliminar "Página X" / "Página X de Y" / "Page X" / "Pág. X"
      .replace(/^\s*(Página|Page|Pág\.?)\s*\d+(\s*(de|of)\s*\d+)?\s*$/gim, '')

      // 5. Eliminar líneas de índice (texto + puntos suspensivos + número)
      .replace(/^.*\.{3,}\s*\d+\s*$/gm, '')

      // 6. Normalizar texto espaciado artificialmente ("h o l a" → "hola")
      .replace(/\b(\w)\s(\w)\s(\w)\s(\w)\b/g, '$1$2$3$4')

      // 7. Eliminar múltiples espacios en blanco
      .replace(/[ \t]{2,}/g, ' ')

      // 8. Colapsar más de 2 líneas vacías consecutivas
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function cleanChunkText(text: string): string {
  return (
    text
      // Solo colapsar párrafos (2+ saltos), preservar saltos simples como espacios
      .replace(/\n{2,}/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

/**
 * Valida si un chunk tiene suficiente valor semántico para ser guardado.
 * Filtra títulos sueltos, índices y contenido sin contexto.
 */
function isValidChunk(text: string): boolean {
  // Muy corto = sin valor
  if (text.length < 80) return false;

  // Solo números o muy pocas palabras
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 8) return false;

  // Es solo un título de sección/capítulo
  if (
    /^(capítulo|sección|artículo|título|índice|anexo)\s*\d*\s*$/i.test(
      text.trim(),
    )
  ) {
    return false;
  }

  // Tiene demasiados números comparado con texto (probablemente tabla de datos)
  const digitRatio = (text.match(/\d/g)?.length ?? 0) / text.length;
  if (digitRatio > 0.4) return false;

  return true;
}

/**
 * Genera hash SHA-256 del contenido para deduplicación.
 */
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Consulta la API para verificar si un hash ya existe en la DB.
 */
async function existsInDb(hash: string): Promise<boolean> {
  try {
    const response = await axios.get<{ exists: boolean }>(EXISTS_URL, {
      params: { hash },
      timeout: 5000,
    });
    return response.data.exists;
  } catch {
    // Si falla la verificación, asumimos que no existe para no bloquear la ingesta
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number | undefined): boolean {
  if (!status) return true;
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function postWithRetry(payload: unknown): Promise<void> {
  const maxAttempts = 6;
  const baseDelayMs = 350;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await axios.post(API_URL, payload);
      return;
    } catch (error: unknown) {
      lastError = error;
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      if (!shouldRetryStatus(status) || attempt === maxAttempts) {
        throw error;
      }

      const jitterMs = Math.floor(Math.random() * 200);
      const delayMs = baseDelayMs * attempt + jitterMs;
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function extractTextFromPdf(pdfPath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(pdfPath);

  const PDFParse = await loadPdfParseConstructor();

  const parser = new PDFParse({ data: dataBuffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function ingestPdfs(): Promise<void> {
  console.log('📚 Iniciando lectura de documentación oficial...');

  if (!fs.existsSync(DOCS_DIR)) {
    console.error(
      `❌ No existe la carpeta ${DOCS_DIR}. Creala y poné los PDFs ahí.`,
    );
    return;
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  // Set para evitar duplicados dentro de la misma ejecución
  const processedHashes = new Set<string>();

  for (const fileInfo of FILES) {
    if (enabledSources.size > 0 && !enabledSources.has(fileInfo.source)) {
      continue;
    }
    if (enabledFiles.size > 0 && !enabledFiles.has(fileInfo.name)) {
      continue;
    }

    const pdfPath = path.join(DOCS_DIR, fileInfo.name);

    if (!fs.existsSync(pdfPath)) {
      console.warn(`⚠️ Archivo no encontrado: ${fileInfo.name} (Saltando...)`);
      continue;
    }

    console.log(
      `\n📄 Procesando: ${fileInfo.description} (${fileInfo.name})...`,
    );

    try {
      const rawText = await extractTextFromPdf(pdfPath);
      const cleanedText = cleanRawText(rawText);

      const chunks = await splitter.createDocuments([cleanedText]);
      console.log(`   ✂️ Se generaron ${chunks.length} fragmentos.`);

      let saved = 0;
      let failed = 0;
      let skipped = 0;
      let firstPostError: unknown = undefined;

      for (const [index, chunk] of chunks.entries()) {
        const content = cleanChunkText(chunk.pageContent);

        // Validación semántica del chunk
        if (!isValidChunk(content)) {
          skipped++;
          continue;
        }

        // Deduplicación por hash (en memoria + DB)
        const contentHash = hashContent(content);
        if (processedHashes.has(contentHash)) {
          skipped++;
          continue;
        }

        // Verificar si ya existe en la base de datos
        if (await existsInDb(contentHash)) {
          processedHashes.add(contentHash);
          skipped++;
          continue;
        }
        processedHashes.add(contentHash);

        const payload = {
          content,
          source: fileInfo.source,
          metadata: {
            filename: fileInfo.name,
            priority: fileInfo.priority,
            chunkIndex: index,
            contentHash,
          },
        };

        try {
          await postWithRetry(payload);
          process.stdout.write('.');
          saved++;
        } catch (error: unknown) {
          process.stdout.write('x');
          failed++;
          if (firstPostError === undefined) firstPostError = error;
        }
      }

      console.log(
        `\n   ✅ Guardados ${saved} fragmentos de ${fileInfo.source}${skipped > 0 ? ` (${skipped} saltados por filtro/duplicados)` : ''}.`,
      );
      if (failed > 0) {
        if (
          firstPostError !== undefined &&
          axios.isAxiosError(firstPostError)
        ) {
          const status = firstPostError.response?.status;
          const statusText = firstPostError.response?.statusText;
          const data: unknown = firstPostError.response?.data;
          const dataPreview =
            data === undefined
              ? ''
              : ` | response=${JSON.stringify(data).slice(0, 300)}`;
          console.warn(
            `   ⚠️ Fallaron ${failed} envíos. Primer error: ${status ?? 'NO_STATUS'} ${statusText ?? ''} ${firstPostError.message}${dataPreview}`,
          );
        } else if (firstPostError instanceof Error) {
          console.warn(
            `   ⚠️ Fallaron ${failed} envíos. Primer error: ${firstPostError.message}`,
          );
        } else {
          console.warn(`   ⚠️ Fallaron ${failed} envíos.`);
        }
      }
    } catch (error) {
      console.error(`ERROR procesando ${fileInfo.name}:`, error);
    }
  }

  console.log('\n🏁 Ingesta de documentos finalizada.');
}

void ingestPdfs().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
