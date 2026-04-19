/**
 * Regenera las preguntas de evaluación para un source específico,
 * preservando las preguntas de los otros sources.
 *
 * Uso: npx ts-node scripts/regen-source-evals.ts --source=manual_pba
 */
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';
import type { EvalQuestion } from './generate-evals';

config({ path: path.join(__dirname, '../.env') });

// ── Config ────────────────────────────────────────────────────────────────────

const EVAL_DATA_DIR = path.join(__dirname, 'eval-data');
const OUTPUT_FILE = path.join(EVAL_DATA_DIR, 'eval-questions.json');
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SAMPLES_PER_SOURCE = 15;
const QUESTIONS_PER_CHUNK = 2;
const DELAY_BETWEEN_CALLS_MS = 250;

// ── Parse CLI arg ─────────────────────────────────────────────────────────────

const sourceArg = process.argv.find((a) => a.startsWith('--source='));
if (!sourceArg) {
  console.error('❌ Debes especificar un source: --source=manual_pba');
  process.exit(1);
}
const TARGET_SOURCE = sourceArg.split('=')[1];

// ── Types ─────────────────────────────────────────────────────────────────────

interface KnowledgeEntryRow {
  id: string;
  content: string;
  source: string;
}

interface LlmQuestionResponse {
  questions: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const META_QUESTION_PATTERNS = [
  /\bdocumento\b/i,
  /\bfragmento\b/i,
  /\btexto\b/i,
  /\bpáginas?\b/i,
  /\bpaginas?\b/i,
  /\bsección\b/i,
  /\bseccion\b/i,
  /\bcapítulo\b/i,
  /\bcapitulo\b/i,
  /\barchivo\b/i,
  /manual.*tiene/i,
  /ley.*tiene/i,
  /cuántas.*páginas/i,
  /cuantas.*paginas/i,
];

function isMetaQuestion(question: string): boolean {
  return META_QUESTION_PATTERNS.some((pattern) => pattern.test(question));
}

function parseQuestionsFromRaw(raw: string): string[] {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const cleaned = jsonMatch[0].replace(/,\s*([\]}])/g, '$1');
      const parsed = JSON.parse(cleaned) as LlmQuestionResponse;
      if (Array.isArray(parsed.questions)) {
        return parsed.questions.filter(
          (q) =>
            typeof q === 'string' && q.trim().length > 0 && !isMetaQuestion(q),
        );
      }
    } catch {
      // fallback to regex
    }
  }
  const matches = raw.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*\?[^"\\]*)"/g);
  return [...matches]
    .map((m) => m[1].replace(/\\n/g, ' ').replace(/\\"/, '"').trim())
    .filter((q) => q.length > 5 && !isMetaQuestion(q));
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
  source: string,
  limit: number,
): Promise<KnowledgeEntryRow[]> {
  const result = await db.query<KnowledgeEntryRow[]>(
    `SELECT id, content, source
     FROM knowledge_entries
     WHERE source = $1
     ORDER BY RANDOM()
     LIMIT $2`,
    [source, limit],
  );
  return result;
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
- NO hacer referencia al documento, fragmento, texto, sección o página en sí (ej: NO "¿Cuántas páginas tiene este documento?")

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

async function main(): Promise<void> {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    console.error('❌ OPENROUTER_API_KEY no está configurado en .env');
    process.exit(1);
  }

  const model = process.env.CHAT_MODEL ?? 'google/gemini-flash-1.5';

  // 1. Load existing questions, keep only non-target sources
  let existingQuestions: EvalQuestion[] = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    existingQuestions = JSON.parse(
      fs.readFileSync(OUTPUT_FILE, 'utf-8'),
    ) as EvalQuestion[];
  }

  const preserved = existingQuestions.filter((q) => q.source !== TARGET_SOURCE);
  const removedCount = existingQuestions.length - preserved.length;

  console.log(
    `🗑️  Eliminando ${removedCount} preguntas antiguas de source "${TARGET_SOURCE}"...`,
  );
  console.log(`✅ Preservando ${preserved.length} preguntas de otros sources.`);

  // 2. Connect to DB
  console.log('\n🔌 Conectando a la base de datos...');
  const db = buildDataSource();
  await db.initialize();

  try {
    const chunks = await sampleChunks(db, TARGET_SOURCE, SAMPLES_PER_SOURCE);

    if (chunks.length === 0) {
      console.error(
        `❌ No se encontraron chunks para source "${TARGET_SOURCE}". ¿Ejecutaste la ingesta?`,
      );
      return;
    }

    console.log(
      `📊 Muestreados ${chunks.length} chunks de "${TARGET_SOURCE}".`,
    );
    console.log(
      `🤖 Generando ${QUESTIONS_PER_CHUNK} preguntas por chunk con ${model}...\n`,
    );

    const newQuestions: EvalQuestion[] = [];
    let processed = 0;

    for (const chunk of chunks) {
      try {
        const questions = await generateQuestionsForChunk(
          chunk.content,
          openRouterKey,
          model,
        );

        for (const question of questions) {
          newQuestions.push({
            question,
            expectedChunkIds: [chunk.id],
            source: chunk.source,
          });
        }

        processed++;
        process.stdout.write(
          `\r   Progreso: ${processed}/${chunks.length} chunks (${newQuestions.length} preguntas generadas)...`,
        );

        await sleep(DELAY_BETWEEN_CALLS_MS);
      } catch (error) {
        const err = error as Error;
        console.warn(
          `\n⚠️  Error en chunk ${chunk.id.slice(0, 8)}: ${err.message}`,
        );
      }
    }

    // 3. Merge and save
    const merged = [...preserved, ...newQuestions];

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(merged, null, 2), 'utf-8');

    const bySource = merged.reduce<Record<string, number>>((acc, q) => {
      acc[q.source] = (acc[q.source] ?? 0) + 1;
      return acc;
    }, {});

    console.log(
      `\n\n✅ ${newQuestions.length} preguntas nuevas generadas para "${TARGET_SOURCE}".`,
    );
    console.log(`💾 Total en archivo: ${merged.length} preguntas`);
    console.log('   Distribución:');
    Object.entries(bySource).forEach(([src, n]) =>
      console.log(`     ${src}: ${n}`),
    );
    console.log(`\n   Guardado en: ${OUTPUT_FILE}`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
