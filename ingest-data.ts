import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const API_URL = 'http://localhost:3000/knowledge/add-entry';
const CHECK_EXISTS_URL = 'http://localhost:3000/knowledge/exists';
const BATCH_SIZE = 3; // Procesar de a 3 para no saturar
const DELAY_BETWEEN_BATCHES_MS = 1000; // 1 segundo entre lotes

interface KnowledgeItem {
  question: string;
  answer: string;
  category: string;
}

function generateContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ingestData() {
  console.log('🚀 Iniciando carga masiva...');

  const filePath = path.join(__dirname, 'knowledge-base.json');
  const questions = JSON.parse(
    fs.readFileSync(filePath, 'utf-8'),
  ) as KnowledgeItem[];

  console.log(
    `📂 Procesando ${questions.length} preguntas en lotes de ${BATCH_SIZE}...\n`,
  );

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  // Dividir en lotes
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const batch = questions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(questions.length / BATCH_SIZE);

    console.log(`\n📦 Lote ${batchNum}/${totalBatches}:`);

    // Procesar lote en paralelo
    const promises = batch.map(async (item) => {
      try {
        const content = `Pregunta: ${item.question}\nRespuesta: ${item.answer}`;
        const contentHash = generateContentHash(content);

        // Verificar si ya existe
        const checkResponse = await axios.get(CHECK_EXISTS_URL, {
          params: { hash: contentHash },
        });

        if (checkResponse.data.exists) {
          process.stdout.write('○ '); // Ya existe, skip
          return { success: true, skipped: true, question: item.question };
        }

        // No existe, insertar
        await axios.post(API_URL, {
          content,
          source: 'knowledge-base.json',
          metadata: {
            category: item.category,
            question: item.question,
            contentHash,
          },
        });
        process.stdout.write('✓ '); // Insertado
        return { success: true, skipped: false, question: item.question };
      } catch (error) {
        const err = error as Error;
        console.error(`\n❌ Falló: "${item.question}" - ${err.message}`);
        return { success: false, skipped: false, question: item.question };
      }
    });

    const results = await Promise.all(promises);
    successCount += results.filter((r) => r.success && !r.skipped).length;
    skippedCount += results.filter((r) => r.skipped).length;
    failedCount += results.filter((r) => !r.success).length;

    // Esperar entre lotes (excepto en el último)
    if (i + BATCH_SIZE < questions.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log(
    `\n\n🏁 Finalizado:\n   ✓ ${successCount} insertados\n   ○ ${skippedCount} ya existían\n   ❌ ${failedCount} fallidos\n   Total: ${questions.length}`,
  );
}

ingestData();
