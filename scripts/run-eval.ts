import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import type { EvalQuestion } from './generate-evals';

// ── Config ────────────────────────────────────────────────────────────────────

const EVAL_DATA_DIR = path.join(__dirname, 'eval-data');
const EVAL_FILE = path.join(EVAL_DATA_DIR, 'eval-questions.json');
const RESULTS_DIR = path.join(EVAL_DATA_DIR, 'results');
const SEARCH_URL = 'http://localhost:3000/knowledge/search';

/** Si se pasa --rerank como argumento, el eval usa el pipeline con reranker */
const USE_RERANKER = process.argv.includes('--rerank');

/** k values para Recall@k */
const K_VALUES = [5, 10] as const;
type KValue = (typeof K_VALUES)[number];

/** Delay entre búsquedas para no saturar el servidor */
const DELAY_BETWEEN_SEARCHES_MS = 100;

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface SearchResultItem {
  id: string;
  content: string;
  source: string;
}

interface EvalResult {
  question: string;
  source: string;
  expectedChunkIds: string[];
  retrievedIds: string[];
  hitAt5: boolean;
  hitAt10: boolean;
}

interface EvalRunSummary {
  timestamp: string;
  totalEvaluated: number;
  recallAt5: number;
  recallAt10: number;
  bySource: Record<
    string,
    { total: number; recallAt5: number; recallAt10: number }
  >;
  details: EvalResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchKnowledge(
  query: string,
  limit: number,
): Promise<SearchResultItem[]> {
  const response = await axios.get<SearchResultItem[]>(SEARCH_URL, {
    params: { q: query, limit, rerank: USE_RERANKER ? 'true' : undefined },
    timeout: 15_000,
  });
  return response.data;
}

/** Devuelve true si alguno de los expectedIds aparece en los top-k resultados. */
function hitAtK(
  retrievedIds: string[],
  expectedIds: string[],
  k: KValue,
): boolean {
  const topK = new Set(retrievedIds.slice(0, k));
  return expectedIds.some((id) => topK.has(id));
}

function formatPercent(hits: number, total: number): string {
  if (total === 0) return 'N/A';
  return `${((hits / total) * 100).toFixed(1)}%`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runEval(): Promise<void> {
  if (!fs.existsSync(EVAL_FILE)) {
    console.error(
      `❌ No se encontró ${EVAL_FILE}.\n   Ejecutá primero: npm run eval:generate`,
    );
    process.exitCode = 1;
    return;
  }

  const evalQuestions = JSON.parse(
    fs.readFileSync(EVAL_FILE, 'utf-8'),
  ) as EvalQuestion[];

  console.log(
    `📋 Evaluando ${evalQuestions.length} preguntas contra el retriever${
      USE_RERANKER ? ' (con reranker)' : ''
    }...`,
  );
  console.log(
    `🎯 Métricas: Recall@${USE_RERANKER ? '5 (reranker top-K)' : K_VALUES.join(' y Recall@')}\n`,
  );

  const results: EvalResult[] = [];
  let processed = 0;

  for (const evalQ of evalQuestions) {
    try {
      // Con reranker el endpoint devuelve solo 5 resultados
      const fetchLimit = 10;
      const retrieved = await searchKnowledge(evalQ.question, fetchLimit);
      const retrievedIds = retrieved.map((r) => r.id);

      results.push({
        question: evalQ.question,
        source: evalQ.source,
        expectedChunkIds: evalQ.expectedChunkIds,
        retrievedIds,
        hitAt5: hitAtK(retrievedIds, evalQ.expectedChunkIds, 5),
        hitAt10: hitAtK(retrievedIds, evalQ.expectedChunkIds, 10),
      });

      processed++;
      process.stdout.write(
        `\r   Progreso: ${processed}/${evalQuestions.length}...`,
      );

      await sleep(DELAY_BETWEEN_SEARCHES_MS);
    } catch (error) {
      const err = error as Error;
      console.warn(
        `\n⚠️  Error buscando "${evalQ.question.slice(0, 50)}...": ${err.message}`,
      );
    }
  }

  console.log('\n');

  if (results.length === 0) {
    console.error(
      '❌ No se pudo evaluar ninguna pregunta. ¿Está corriendo el servidor?',
    );
    process.exitCode = 1;
    return;
  }

  // ── Métricas globales ──────────────────────────────────────────────────────
  const total = results.length;
  const hitsAt5 = results.filter((r) => r.hitAt5).length;
  const hitsAt10 = results.filter((r) => r.hitAt10).length;

  console.log('═══════════════════════════════════════════════════');
  console.log(
    `         RESULTADOS DE EVALUACIÓN RAG ${USE_RERANKER ? '(+RERANKER)' : ''}`,
  );
  console.log('═══════════════════════════════════════════════════');
  console.log(
    `  Recall@5:   ${formatPercent(hitsAt5, total).padStart(7)}   (${hitsAt5}/${total} preguntas)`,
  );
  if (!USE_RERANKER) {
    console.log(
      `  Recall@10:  ${formatPercent(hitsAt10, total).padStart(7)}   (${hitsAt10}/${total} preguntas)`,
    );
  }
  console.log('───────────────────────────────────────────────────');

  // ── Desglose por source ────────────────────────────────────────────────────
  const sources = [...new Set(results.map((r) => r.source))].sort();
  console.log('\n  Desglose por source:');
  for (const source of sources) {
    const sr = results.filter((r) => r.source === source);
    const srcHitsAt5 = sr.filter((r) => r.hitAt5).length;
    const srcHitsAt10 = sr.filter((r) => r.hitAt10).length;
    const r10str = USE_RERANKER
      ? ''
      : `  R@10: ${formatPercent(srcHitsAt10, sr.length).padStart(6)}`;
    console.log(
      `    ${source.padEnd(24)} R@5: ${formatPercent(srcHitsAt5, sr.length).padStart(6)}${r10str}  (n=${sr.length})`,
    );
  }

  // ── Peores queries (misses en top 10) ─────────────────────────────────────
  const misses = results.filter((r) => !r.hitAt10);
  if (misses.length > 0) {
    console.log(`\n  ⚠️  No encontradas en top 10 (${misses.length} queries):`);
    misses.slice(0, 5).forEach((r) => {
      console.log(`    [${r.source}] "${r.question.slice(0, 72)}"`);
    });
    if (misses.length > 5) {
      console.log(`    ... y ${misses.length - 5} más.`);
    }
  }

  console.log('═══════════════════════════════════════════════════\n');

  // ── Guardar resultado con timestamp ───────────────────────────────────────
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultFile = path.join(RESULTS_DIR, `eval-${timestamp}.json`);

  const summary: EvalRunSummary = {
    timestamp: new Date().toISOString(),
    totalEvaluated: total,
    recallAt5: hitsAt5 / total,
    recallAt10: hitsAt10 / total,
    bySource: Object.fromEntries(
      sources.map((s) => {
        const sr = results.filter((r) => r.source === s);
        const srHitsAt5 = sr.filter((r) => r.hitAt5).length;
        const srHitsAt10 = sr.filter((r) => r.hitAt10).length;
        return [
          s,
          {
            total: sr.length,
            recallAt5: sr.length > 0 ? srHitsAt5 / sr.length : 0,
            recallAt10: sr.length > 0 ? srHitsAt10 / sr.length : 0,
          },
        ];
      }),
    ),
    details: results,
  };

  fs.writeFileSync(resultFile, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`💾 Resultado guardado en: ${resultFile}`);
  console.log(
    '   (Compará archivos en scripts/eval-data/results/ para ver evolución)\n',
  );
}

void runEval().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
