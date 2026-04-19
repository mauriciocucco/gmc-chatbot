import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import type { EvalQuestion } from './generate-evals';

// ── Config ────────────────────────────────────────────────────────────────────

const EVAL_DATA_DIR = path.join(__dirname, 'eval-data');
const EVAL_FILE = path.join(EVAL_DATA_DIR, 'eval-questions.json');
const RESULTS_DIR = path.join(EVAL_DATA_DIR, 'results');
const ASK_URL = 'http://localhost:3000/knowledge/ask-with-context';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Preguntas a evaluar (subset para no gastar demasiado en API) */
const MAX_QUESTIONS = 40;
/** Delay entre llamadas al LLM juez */
const DELAY_BETWEEN_CALLS_MS = 300;

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface AskWithContextResponse {
  question: string;
  answer: string;
  context: Array<{ id: string; content: string; source: string }>;
}

interface JudgeVerdict {
  correct: boolean;
  grounded: boolean;
  complete: boolean;
}

interface AnswerEvalResult {
  question: string;
  source: string;
  answer: string;
  verdict: JudgeVerdict | null;
  error?: string;
}

interface AnswerEvalSummary {
  timestamp: string;
  totalEvaluated: number;
  pctCorrect: number;
  pctGrounded: number;
  pctComplete: number;
  bySource: Record<
    string,
    {
      total: number;
      pctCorrect: number;
      pctGrounded: number;
      pctComplete: number;
    }
  >;
  details: AnswerEvalResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY no configurado en .env');
  return key;
}

function getModel(): string {
  return process.env.CHAT_MODEL ?? 'google/gemini-flash-1.5';
}

async function getAnswerWithContext(
  question: string,
): Promise<AskWithContextResponse> {
  const response = await axios.get<AskWithContextResponse>(ASK_URL, {
    params: { q: question },
    timeout: 35_000,
  });
  return response.data;
}

async function judgeAnswer(
  question: string,
  answer: string,
  context: Array<{ content: string; source: string }>,
  openRouterKey: string,
  model: string,
): Promise<JudgeVerdict | null> {
  const formattedContext = context
    .map((c, i) => `[${i + 1}] (${c.source}) ${c.content.slice(0, 400)}`)
    .join('\n\n');

  const prompt = `Sos un evaluador experto de sistemas de preguntas y respuestas sobre normativa de tránsito argentina.

Evaluá la siguiente respuesta y devolvé ÚNICAMENTE un JSON válido con este formato:
{"correct": true/false, "grounded": true/false, "complete": true/false}

Definiciones:
- correct: La respuesta es factualmente precisa según el contexto y el conocimiento general de tránsito.
- grounded: La respuesta se basa en la información del contexto recuperado (no inventa datos).
- complete: La respuesta aborda todos los aspectos relevantes de la pregunta.

Contexto recuperado:
${formattedContext}

Pregunta: ${question}
Respuesta: ${answer}

Respondé SOLO con el JSON, sin explicaciones adicionales.`;

  const response = await axios.post<{
    choices: Array<{ message: { content: string } }>;
  }>(
    OPENROUTER_API_URL,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 60,
    },
    {
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://autoescuela-gmc.com',
        'X-Title': 'Autoescuela GMC Answer Evaluator',
      },
      timeout: 20_000,
    },
  );

  const raw = response.data.choices[0]?.message?.content ?? '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const cleaned = jsonMatch[0].replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(cleaned) as JudgeVerdict;
}

function formatPct(hits: number, total: number): string {
  if (total === 0) return 'N/A';
  return `${((hits / total) * 100).toFixed(1)}%`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runAnswerEval(): Promise<void> {
  if (!fs.existsSync(EVAL_FILE)) {
    console.error(
      `❌ No se encontró ${EVAL_FILE}.\n   Ejecutá primero: npm run eval:generate`,
    );
    process.exitCode = 1;
    return;
  }

  // Cargar .env
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.join(__dirname, '../.env') });

  const openRouterKey = getOpenRouterKey();
  const model = getModel();

  const allQuestions = JSON.parse(
    fs.readFileSync(EVAL_FILE, 'utf-8'),
  ) as EvalQuestion[];

  // Samplear distribuyendo por source para evaluación balanceada
  const sources = [...new Set(allQuestions.map((q) => q.source))];
  const perSource = Math.floor(MAX_QUESTIONS / sources.length);
  const questions: EvalQuestion[] = sources.flatMap((s) =>
    allQuestions.filter((q) => q.source === s).slice(0, perSource),
  );

  console.log(`📋 Evaluando calidad de respuestas (LLM-as-Judge)`);
  console.log(`   Preguntas: ${questions.length} | Modelo juez: ${model}\n`);

  const results: AnswerEvalResult[] = [];
  let processed = 0;

  for (const evalQ of questions) {
    try {
      const { answer, context } = await getAnswerWithContext(evalQ.question);

      const verdict = await judgeAnswer(
        evalQ.question,
        answer,
        context,
        openRouterKey,
        model,
      );

      results.push({
        question: evalQ.question,
        source: evalQ.source,
        answer,
        verdict,
      });
    } catch (error) {
      const err = error as Error;
      results.push({
        question: evalQ.question,
        source: evalQ.source,
        answer: '',
        verdict: null,
        error: err.message,
      });
    }

    processed++;
    process.stdout.write(`\r   Progreso: ${processed}/${questions.length}...`);
    await sleep(DELAY_BETWEEN_CALLS_MS);
  }

  console.log('\n');

  const evaluated = results.filter((r) => r.verdict !== null);
  const total = evaluated.length;

  if (total === 0) {
    console.error('❌ No se pudo evaluar ninguna respuesta.');
    process.exitCode = 1;
    return;
  }

  const correct = evaluated.filter((r) => r.verdict!.correct).length;
  const grounded = evaluated.filter((r) => r.verdict!.grounded).length;
  const complete = evaluated.filter((r) => r.verdict!.complete).length;

  console.log('═══════════════════════════════════════════════════');
  console.log('       EVALUACIÓN DE CALIDAD DE RESPUESTAS         ');
  console.log('═══════════════════════════════════════════════════');
  console.log(
    `  Correctas:    ${formatPct(correct, total).padStart(7)}   (${correct}/${total})`,
  );
  console.log(
    `  Fundamentadas:${formatPct(grounded, total).padStart(7)}   (${grounded}/${total})`,
  );
  console.log(
    `  Completas:    ${formatPct(complete, total).padStart(7)}   (${complete}/${total})`,
  );
  console.log('───────────────────────────────────────────────────');

  // Desglose por source
  console.log('\n  Desglose por source:');
  for (const source of sources) {
    const sr = evaluated.filter((r) => r.source === source);
    if (sr.length === 0) continue;
    const sc = sr.filter((r) => r.verdict!.correct).length;
    const sg = sr.filter((r) => r.verdict!.grounded).length;
    const sk = sr.filter((r) => r.verdict!.complete).length;
    console.log(
      `    ${source.padEnd(24)} C:${formatPct(sc, sr.length).padStart(6)}  G:${formatPct(sg, sr.length).padStart(6)}  K:${formatPct(sk, sr.length).padStart(6)}  (n=${sr.length})`,
    );
  }

  // Peores respuestas (incorrectas Y no fundamentadas)
  const bad = evaluated.filter(
    (r) => !r.verdict!.correct && !r.verdict!.grounded,
  );
  if (bad.length > 0) {
    console.log(
      `\n  ⚠️  Respuestas incorrectas y no fundamentadas (${bad.length}):`,
    );
    bad.slice(0, 5).forEach((r) => {
      console.log(`    [${r.source}] "${r.question.slice(0, 70)}"`);
      console.log(`           → "${r.answer.slice(0, 80)}..."`);
    });
  }

  console.log('═══════════════════════════════════════════════════\n');

  // Guardar resultado
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultFile = path.join(RESULTS_DIR, `answer-eval-${timestamp}.json`);

  const summary: AnswerEvalSummary = {
    timestamp: new Date().toISOString(),
    totalEvaluated: total,
    pctCorrect: correct / total,
    pctGrounded: grounded / total,
    pctComplete: complete / total,
    bySource: Object.fromEntries(
      sources.map((s) => {
        const sr = evaluated.filter((r) => r.source === s);
        return [
          s,
          {
            total: sr.length,
            pctCorrect:
              sr.length > 0
                ? sr.filter((r) => r.verdict!.correct).length / sr.length
                : 0,
            pctGrounded:
              sr.length > 0
                ? sr.filter((r) => r.verdict!.grounded).length / sr.length
                : 0,
            pctComplete:
              sr.length > 0
                ? sr.filter((r) => r.verdict!.complete).length / sr.length
                : 0,
          },
        ];
      }),
    ),
    details: results,
  };

  fs.writeFileSync(resultFile, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`💾 Resultado guardado en: ${resultFile}`);
  console.log('   (C=correct, G=grounded, K=complete)\n');
}

void runAnswerEval().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
