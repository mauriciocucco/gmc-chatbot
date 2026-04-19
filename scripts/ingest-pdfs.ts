import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TokenTextSplitter } from '@langchain/textsplitters';
import {
  describeNormalizedBlock,
  isValidChunk,
  normalizePdfContent,
  type PdfSource,
} from '../src/knowledge/pdf-normalization';

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

type Priority = 'alta' | 'media' | 'baja';

interface FileInfo {
  name: string;
  source: PdfSource;
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
    description: 'Ley Nacional de Transito (CNEV)',
  },
  {
    name: 'preguntas_examen.pdf',
    source: 'bateria_preguntas',
    priority: 'alta',
    description: 'Bateria de Preguntas Examen',
  },
];

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const enabledSources = new Set<PdfSource>(
  parseCsvEnv(process.env.INGEST_SOURCES) as PdfSource[],
);

const enabledFiles = new Set<string>(parseCsvEnv(process.env.INGEST_FILES));

function cleanRawText(text: string): string {
  return (
    text
      .replace(/\x00/g, '')
      .replace(/\uFFFD/g, '')
      .replace(/[â€¢Â·â—â—‹â– â–¡â–ªâ–«]/g, '-')
      .replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2')
      .replace(/^\s*\d+\s*$/gm, '')
      .replace(/^\s*(PÃ¡gina|Page|PÃ¡g\.?)\s*\d+(\s*(de|of)\s*\d+)?\s*$/gim, '')
      .replace(/^.*\.{3,}\s*\d+\s*$/gm, '')
      .replace(/\b(\w)\s(\w)\s(\w)\s(\w)\b/g, '$1$2$3$4')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function cleanChunkText(text: string): string {
  return text
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function existsInDb(hash: string): Promise<boolean> {
  try {
    const response = await axios.get<{ exists: boolean }>(EXISTS_URL, {
      params: { hash },
      timeout: 5000,
    });
    return response.data.exists;
  } catch {
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
      await sleep(baseDelayMs * attempt + jitterMs);
    }
  }

  throw lastError;
}

async function extractTextFromPdf(pdfPath: string): Promise<string> {
  const PDFParse = await loadPdfParseConstructor();
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });

  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function ingestPdfs(): Promise<void> {
  console.log('📚 Iniciando lectura de documentacion oficial...');

  if (!fs.existsSync(DOCS_DIR)) {
    console.error(`❌ No existe la carpeta ${DOCS_DIR}. Creala y pone los PDFs ahi.`);
    return;
  }

  const chunkSize = parseInt(process.env.CHUNK_SIZE ?? '512', 10);
  const chunkOverlap = parseInt(process.env.CHUNK_OVERLAP ?? '50', 10);

  const splitter = new TokenTextSplitter({
    chunkSize,
    chunkOverlap,
    encodingName: 'cl100k_base',
  });

  console.log(`   ✂️ Chunk size: ${chunkSize} tokens, overlap: ${chunkOverlap} tokens`);

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
      console.warn(`⚠️ Archivo no encontrado: ${fileInfo.name} (saltando)`);
      continue;
    }

    console.log(`\n📄 Procesando: ${fileInfo.description} (${fileInfo.name})...`);

    try {
      const rawText = await extractTextFromPdf(pdfPath);
      const cleanedText = cleanRawText(rawText);
      const normalizedBlocks = normalizePdfContent(
        fileInfo.source,
        cleanedText,
        fileInfo.description,
      );

      console.log(`   📑 Bloques normalizados: ${normalizedBlocks.length}`);

      let globalChunkIndex = 0;
      let saved = 0;
      let failed = 0;
      let skipped = 0;
      let firstPostError: unknown = undefined;

      for (const block of normalizedBlocks) {
        const blockChunks =
          block.chunkStrategy === 'single'
            ? [{ pageContent: block.content }]
            : await splitter.createDocuments([block.content]);

        for (const chunk of blockChunks) {
          const chunkText = cleanChunkText(chunk.pageContent);

          if (!isValidChunk(chunkText, block.metadata)) {
            skipped++;
            globalChunkIndex++;
            continue;
          }

          const contextPrefix = `Documento: ${fileInfo.description}\nSeccion: ${block.sectionHeader}\n\n`;
          const content = contextPrefix + chunkText;
          const contentHash = hashContent(content);

          if (processedHashes.has(contentHash)) {
            skipped++;
            globalChunkIndex++;
            continue;
          }

          if (await existsInDb(contentHash)) {
            processedHashes.add(contentHash);
            skipped++;
            globalChunkIndex++;
            continue;
          }

          processedHashes.add(contentHash);

          const payload = {
            content,
            source: fileInfo.source,
            metadata: {
              filename: fileInfo.name,
              priority: fileInfo.priority,
              chunkIndex: globalChunkIndex,
              sectionHeader: block.sectionHeader,
              ...block.metadata,
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
            console.warn(
              `\n   ⚠️ Fallo en bloque ${describeNormalizedBlock(block)} (chunk ${globalChunkIndex})`,
            );
          }

          globalChunkIndex++;
        }
      }

      const totalProcessed = saved + failed + skipped;
      console.log(
        `\n   ✅ Guardados ${saved} fragmentos de ${fileInfo.source}${skipped > 0 ? ` (${skipped}/${totalProcessed} saltados)` : ''}.`,
      );

      if (failed > 0) {
        if (firstPostError !== undefined && axios.isAxiosError(firstPostError)) {
          const status = firstPostError.response?.status;
          const statusText = firstPostError.response?.statusText;
          const data = firstPostError.response?.data;
          const dataPreview =
            data === undefined
              ? ''
              : ` | response=${JSON.stringify(data).slice(0, 300)}`;
          console.warn(
            `   ⚠️ Fallaron ${failed} envios. Primer error: ${status ?? 'NO_STATUS'} ${statusText ?? ''} ${firstPostError.message}${dataPreview}`,
          );
        } else if (firstPostError instanceof Error) {
          console.warn(
            `   ⚠️ Fallaron ${failed} envios. Primer error: ${firstPostError.message}`,
          );
        } else {
          console.warn(`   ⚠️ Fallaron ${failed} envios.`);
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
