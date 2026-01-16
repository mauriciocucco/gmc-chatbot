import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'http://localhost:3000/knowledge/add-entry';
const EXISTS_URL = 'http://localhost:3000/knowledge/exists';
const JSON_FILE = path.join(__dirname, '../knowledge-base.json');

interface RuleItem {
  category?: string;
  question: string;
  answer: string;
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

/**
 * Valida que un item tenga los campos mínimos requeridos.
 */
function isValidItem(item: RuleItem): boolean {
  return (
    typeof item.question === 'string' &&
    item.question.trim().length > 0 &&
    typeof item.answer === 'string' &&
    item.answer.trim().length > 0
  );
}

async function ingestRules(): Promise<void> {
  console.log('🚀 Migrando Reglas Locales (JSON) a Vector Store Unificado...');

  if (!fs.existsSync(JSON_FILE)) {
    console.error(`❌ No existe el archivo ${JSON_FILE}`);
    return;
  }

  const rawData = fs.readFileSync(JSON_FILE, 'utf-8');
  const items: RuleItem[] = JSON.parse(rawData);

  console.log(`📂 Procesando ${items.length} reglas...`);

  const processedHashes = new Set<string>();
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  let firstError: unknown;

  for (const item of items) {
    // Validar campos requeridos
    if (!isValidItem(item)) {
      skipped++;
      continue;
    }

    // Formateamos como texto "rico" para el embedding
    const content = `PREGUNTA: ${item.question.trim()}\nRESPUESTA: ${item.answer.trim()}\nCATEGORÍA: ${item.category?.trim() || 'General'}`;

    // Deduplicación por hash (en memoria)
    const contentHash = hashContent(content);
    if (processedHashes.has(contentHash)) {
      skipped++;
      continue;
    }

    // Verificar si ya existe en la DB
    if (await existsInDb(contentHash)) {
      processedHashes.add(contentHash);
      skipped++;
      continue;
    }
    processedHashes.add(contentHash);

    const payload = {
      content,
      source: 'reglas_locales',
      metadata: {
        original_category: item.category?.trim() || 'General',
        type: 'qa_pair',
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
      if (firstError === undefined) firstError = error;
    }
  }

  console.log(
    `\n\n🏁 Finalizado: ${saved} guardadas${skipped > 0 ? `, ${skipped} saltadas (duplicados/inválidas)` : ''}${failed > 0 ? `, ${failed} fallidas` : ''}.`,
  );

  if (failed > 0 && firstError !== undefined) {
    if (axios.isAxiosError(firstError)) {
      const status = firstError.response?.status;
      const data: unknown = firstError.response?.data;
      const dataPreview =
        data === undefined
          ? ''
          : ` | response=${JSON.stringify(data).slice(0, 300)}`;
      console.warn(
        `⚠️ Primer error: ${status ?? 'NO_STATUS'} ${firstError.message}${dataPreview}`,
      );
    } else if (firstError instanceof Error) {
      console.warn(`⚠️ Primer error: ${firstError.message}`);
    }
  }
}

void ingestRules().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
