import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

config({ path: path.join(__dirname, '../.env') });

// ── Config ────────────────────────────────────────────────────────────────────

const EVAL_DATA_DIR = path.join(__dirname, 'eval-data');
const OUTPUT_FILE = path.join(EVAL_DATA_DIR, 'eval-questions.json');
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Chunks sampled per source — balances coverage vs. costo de API */
const SAMPLES_PER_SOURCE = 15;
/** Preguntas generadas por chunk */
const QUESTIONS_PER_CHUNK = 2;
/** Delay entre llamadas al LLM para no saturar rate limits */
const DELAY_BETWEEN_CALLS_MS = 250;

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface KnowledgeEntryRow {
  id: string;
  content: string;
  source: string;
}

export interface EvalQuestion {
  question: string;
  expectedChunkIds: string[];
  source: string;
}

interface LlmQuestionResponse {
  questions: string[];
}

/**
 * Extrae preguntas del texto raw devuelto por el LLM.
 * Estrategia 1: parsear JSON (con limpieza de trailing commas).
 * Estrategia 2: regex sobre strings entre comillas que parezcan preguntas.
 * Nunca lanza error — devuelve array vacío en el peor caso.
 */
function parseQuestionsFromRaw(raw: string): string[] {
  // Extraer el bloque JSON si existe
  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    try {
      // Limpiar trailing commas antes de ] o }
      const cleaned = jsonMatch[0].replace(/,\s*([\]}])/g, '$1');
      const parsed = JSON.parse(cleaned) as LlmQuestionResponse;
      if (Array.isArray(parsed.questions)) {
        return parsed.questions.filter(
          (q) => typeof q === 'string' && q.trim().length > 0,
        );
      }
    } catch {
      // Fallback a regex
    }
  }

  // Fallback: extraer strings entrecomilladas que contengan '?'
  const matches = raw.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*\?[^"\\]*)"/g);
  const questions = [...matches]
    .map((m) => m[1].replace(/\\n/g, ' ').replace(/\\"/, '"').trim())
    .filter((q) => q.length > 5);

  return questions;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [join(__dirname, '../src', '**', '*.entity.ts')],
    synchronize: false,
    ssl:
      process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: process.env.NODE_ENV === 'production' }
        : false,
  });
}

async function sampleChunks(
  db: DataSource,
  sources: string[],
  samplesPerSource: number,
): Promise<KnowledgeEntryRow[]> {
  const rows: KnowledgeEntryRow[] = [];

  for (const source of sources) {
    const result = await db.query<KnowledgeEntryRow[]>(
      `SELECT id, content, source
       FROM knowledge_entries
       WHERE source = $1
       ORDER BY RANDOM()
       LIMIT $2`,
      [source, samplesPerSource],
    );

    rows.push(...result);
  }

  return rows;
}

async function generateQuestionsForChunk(
  content: string,
  openRouterKey: string,
  model: string,
): Promise<string[]> {
  const prompt = `Sos un alumno de autoescuela en Argentina. Leé el siguiente fragmento de texto y generá exactamente ${QUESTIONS_PER_CHUNK} preguntas específicas que este texto puede responder.

Las preguntas deben:
- Ser concretas y específicas (no "¿De qué trata esto?")
- Ser como las haría un alumno antes de rendir el examen de conducir
- Estar en español rioplatense (vos, tenés)
- Poder responderse solo con la información del fragmento

Fragmento:
${content}

Respondé ÚNICAMENTE con un JSON válido con este formato exacto:
{"questions": ["pregunta 1", "pregunta 2"]}`;

  const response = await axios.post<{
    choices: Array<{ message: { content: string } }>;
  }>(
    OPENROUTER_API_URL,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    },
    {
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://autoescuela-gmc.com',
        'X-Title': 'Autoescuela GMC Eval Generator',
      },
      timeout: 30_000,
    },
  );

  const rawContent = response.data.choices[0]?.message?.content ?? '';

  return parseQuestionsFromRaw(rawContent);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function generateEvals(): Promise<void> {
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  if (!openRouterKey) {
    console.error('❌ OPENROUTER_API_KEY no está configurado en .env');
    process.exitCode = 1;
    return;
  }

  const model = process.env.CHAT_MODEL ?? 'google/gemini-flash-1.5';

  console.log('🔌 Conectando a la base de datos...');

  const dataSource = buildDataSource();

  await dataSource.initialize();

  try {
    const sources = [
      'manual_pba',
      'cnev_nacional',
      'bateria_preguntas',
      'reglas_locales',
    ];
    const chunks = await sampleChunks(dataSource, sources, SAMPLES_PER_SOURCE);

    if (chunks.length === 0) {
      console.error(
        '❌ No se encontraron chunks en la DB. ¿Ejecutaste la ingesta primero?',
      );
      return;
    }

    const sourceCounts = sources.map((s) => {
      const count = chunks.filter((c) => c.source === s).length;
      return `${s}: ${count}`;
    });

    console.log(
      `📊 Chunks seleccionados: ${chunks.length} (${sourceCounts.join(', ')})`,
    );
    console.log(
      `🤖 Generando ${QUESTIONS_PER_CHUNK} preguntas por chunk con ${model}...\n`,
    );

    const evalQuestions: EvalQuestion[] = [];
    let processed = 0;

    for (const chunk of chunks) {
      try {
        const questions = await generateQuestionsForChunk(
          chunk.content,
          openRouterKey,
          model,
        );

        for (const question of questions) {
          evalQuestions.push({
            question,
            expectedChunkIds: [chunk.id],
            source: chunk.source,
          });
        }

        processed++;
        process.stdout.write(
          `\r   Progreso: ${processed}/${chunks.length} chunks (${evalQuestions.length} preguntas generadas)...`,
        );

        await sleep(DELAY_BETWEEN_CALLS_MS);
      } catch (error) {
        const err = error as Error;

        console.warn(
          `\n⚠️  Error en chunk ${chunk.id.slice(0, 8)}: ${err.message}`,
        );
      }
    }

    console.log(
      `\n\n✅ ${evalQuestions.length} preguntas de evaluación generadas.`,
    );

    if (!fs.existsSync(EVAL_DATA_DIR)) {
      fs.mkdirSync(EVAL_DATA_DIR, { recursive: true });
    }

    fs.writeFileSync(
      OUTPUT_FILE,
      JSON.stringify(evalQuestions, null, 2),
      'utf-8',
    );
    console.log(`💾 Guardado en: ${OUTPUT_FILE}`);
    console.log('\n📋 Próximos pasos:');
    console.log(
      '   1. Revisá algunas preguntas en scripts/eval-data/eval-questions.json',
    );
    console.log(
      '   2. Ejecutá "npm run eval:run" para medir Recall@k (baseline)',
    );
    console.log('   3. Re-ingestá con el nuevo chunking contextual');
    console.log(
      '   4. Volvé a ejecutar "npm run eval:generate" + "npm run eval:run" y compará',
    );
  } finally {
    await dataSource.destroy();
  }
}

void generateEvals().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
