import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  Inject,
  OnModuleInit,
} from '@nestjs/common';
import axios from 'axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeEntry } from './entities/knowledge-entry.entity';

/** Dimensión por defecto para text-embedding-3-small */
const DEFAULT_EMBEDDING_DIMENSION = 1536;

/** Candidatos recuperados antes de reranquear (cast wide net) */
const RERANKER_CANDIDATE_COUNT = 15;
/** Top-k final que pasa al prompt del LLM */
const RERANKER_TOP_K = 5;
/** Timeout para la llamada al reranker (ms). Agresivo para proteger el budget de WhatsApp */
const RERANKER_TIMEOUT_MS = 5_000;

/** Resultado de la query híbrida de búsqueda de conocimiento */
interface HybridSearchResult {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  hybrid_score: number;
}
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { PromptTemplate } from '@langchain/core/prompts';
import { normalizeRagQuery } from './rag-query-normalization';

/**
 * KnowledgeService - Motor RAG del chatbot
 *
 * Arquitectura de modelos:
 * - Embeddings: OpenAI (text-embedding-3-small) - No cambiar sin re-vectorizar la DB
 * - Chat: OpenRouter (permite cambiar de modelo con una variable de entorno)
 *
 * Modelos disponibles en CHAT_MODEL:
 * - google/gemini-flash-1.5     → Más rápido, ideal para WhatsApp
 * - anthropic/claude-3.5-haiku  → Balance velocidad/calidad
 * - deepseek/deepseek-chat      → Más inteligente, puede tener latencia
 * - qwen/qwen-2.5-72b-instruct  → Buen español
 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);
  private embeddingsModel: OpenAIEmbeddings;
  private chatModel: ChatOpenAI;

  // Pesos configurables para búsqueda híbrida (desde .env)
  private readonly semanticWeight: number;
  private readonly lexicalWeight: number;

  // Dimensión del modelo de embeddings (text-embedding-3-small = 1536)
  private readonly embeddingDimension: number;

  // Timeout para LLM (WhatsApp tiene timeouts estrictos)
  private readonly LLM_TIMEOUT_MS = 30_000;
  private readonly LLM_MAX_RETRIES = 2;

  // Reranker config
  private readonly rerankerEnabled: boolean;
  private readonly hfApiKey: string | undefined;
  private readonly rerankerEndpoint: string;
  private warmupIntervalRef?: NodeJS.Timeout;

  constructor(
    @InjectRepository(KnowledgeEntry)
    private readonly knowledgeRepo: Repository<KnowledgeEntry>,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {
    // Pesos RAG híbrido desde variables de entorno
    this.semanticWeight = parseFloat(
      this.configService.get<string>('RAG_SEMANTIC_WEIGHT') ?? '0.6',
    );
    this.lexicalWeight = 1 - this.semanticWeight;
    this.logger.log(
      `⚖️ RAG weights: semantic=${this.semanticWeight}, lexical=${this.lexicalWeight}`,
    );

    // Dimensión de embeddings (debe coincidir con el modelo usado)
    this.embeddingDimension = parseInt(
      this.configService.get<string>('EMBEDDING_DIMENSION') ??
        String(DEFAULT_EMBEDDING_DIMENSION),
      10,
    );

    // Embeddings: Mantener OpenAI (cambiar implica re-vectorizar toda la DB)
    this.embeddingsModel = new OpenAIEmbeddings({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      modelName: 'text-embedding-3-small',
    });

    // Chat: OpenRouter - Cambiá CHAT_MODEL en .env para probar otros cerebros
    const chatModel =
      this.configService.get<string>('CHAT_MODEL') ?? 'google/gemini-flash-1.5';
    const openRouterKey = this.configService.get<string>('OPENROUTER_API_KEY');

    if (!openRouterKey) {
      this.logger.error(
        '❌ FALTA LA KEY DE OPENROUTER EN .ENV (OPENROUTER_API_KEY)',
      );
    } else {
      this.logger.log(
        `🔑 OpenRouter Key detectada: ${openRouterKey.substring(0, 10)}...`,
      );
    }

    this.chatModel = new ChatOpenAI({
      apiKey: openRouterKey,
      modelName: chatModel,
      temperature: 0.3,
      maxTokens: 300,
      timeout: this.LLM_TIMEOUT_MS, // Evita que WhatsApp expire
      maxRetries: this.LLM_MAX_RETRIES, // Retry con backoff automático
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://autoescuela-gmc.com',
          'X-Title': 'Autoescuela GMC Bot',
          Authorization: `Bearer ${openRouterKey}`,
        },
      },
    });

    this.logger.log(
      `🧠 Chat model: ${chatModel} (timeout=${this.LLM_TIMEOUT_MS}ms, retries=${this.LLM_MAX_RETRIES})`,
    );

    // Reranker: habilitado con RERANKER_ENABLED=true en .env
    this.rerankerEnabled =
      this.configService.get<string>('RERANKER_ENABLED') === 'true';
    this.hfApiKey = this.configService.get<string>('HF_API_KEY');
    const rerankerModel =
      this.configService.get<string>('RERANKER_MODEL') ??
      'BAAI/bge-reranker-v2-m3';
    this.rerankerEndpoint = `https://router.huggingface.co/hf-inference/models/${rerankerModel}`;

    if (this.rerankerEnabled) {
      this.logger.log(
        `🔀 Reranker habilitado: ${rerankerModel} (timeout=${RERANKER_TIMEOUT_MS}ms, top_k=${RERANKER_TOP_K})`,
      );
      if (!this.hfApiKey) {
        this.logger.warn(
          '⚠️ RERANKER_ENABLED=true pero HF_API_KEY no está configurado. Reranker desactivado.',
        );
      }
    }
  }

  onModuleInit(): void {
    if (!this.rerankerEnabled || !this.hfApiKey) return;

    // Warmup periódico: mantiene el modelo HF despierto para evitar cold starts de 10-30s
    this.warmupIntervalRef = setInterval(
      () => {
        void axios
          .post(
            this.rerankerEndpoint,
            { inputs: [{ text: 'warmup', text_pair: 'warmup' }] },
            {
              headers: {
                Authorization: `Bearer ${this.hfApiKey}`,
                'Content-Type': 'application/json',
              },
              timeout: RERANKER_TIMEOUT_MS,
            },
          )
          .catch(() => {
            // Silent fail — el warmup es best-effort
          });
      },
      5 * 60 * 1000,
    ); // cada 5 minutos

    this.logger.log('🔥 Warmup periódico del reranker activado (cada 5 min)');
  }

  async addKnowledgeEntry(
    content: string,
    source: string,
    metadata: Record<string, any> = {},
  ): Promise<KnowledgeEntry> {
    try {
      const embedding = await this.embeddingsModel.embedQuery(content);

      // Validar dimensión del embedding (previene corrupción de DB al cambiar modelo)
      if (embedding.length !== this.embeddingDimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.embeddingDimension}, got ${embedding.length}. ` +
            `¿Cambiaste el modelo de embeddings? Necesitás re-vectorizar la DB.`,
        );
      }

      const newEntry = this.knowledgeRepo.create({
        content,
        source,
        metadata,
        embedding,
      });
      const savedEntry = await this.knowledgeRepo.save(newEntry);
      this.logger.log(`✅ Fragmento guardado (Source: ${source})`);
      return savedEntry;
    } catch (error) {
      const normalized = this.normalizeUpstreamError(error);
      this.logger.error(
        `Error adding knowledge entry (source=${source}, status=${normalized.status}): ${normalized.message}`,
        normalized.stack,
      );

      throw new HttpException(
        {
          statusCode: normalized.status,
          message: normalized.message,
          error: normalized.publicError,
        },
        normalized.status,
      );
    }
  }

  private normalizeUpstreamError(error: unknown): {
    status: number;
    message: string;
    publicError: string;
    stack?: string;
  } {
    const isRecord = (value: unknown): value is Record<string, unknown> => {
      return typeof value === 'object' && value !== null;
    };

    const fallback = {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Upstream error',
      publicError: 'INTERNAL_ERROR',
      stack: undefined as string | undefined,
    };

    if (error instanceof Error) {
      fallback.message = error.message;
      fallback.stack = error.stack;
    }

    const errorRecord = isRecord(error) ? error : undefined;
    const statusCandidate: unknown =
      errorRecord?.['status'] ?? errorRecord?.['statusCode'];
    if (typeof statusCandidate === 'number' && statusCandidate >= 400) {
      fallback.status = statusCandidate;
    }

    const codeCandidate: unknown = errorRecord?.['code'];
    if (typeof codeCandidate === 'string' && codeCandidate.length > 0) {
      fallback.publicError = codeCandidate;
    }

    // Heurística: algunos errores de OpenAI/LangChain vienen como { error: { type/code/message } }
    const nestedError = isRecord(errorRecord?.['error'])
      ? errorRecord?.['error']
      : undefined;

    const nestedMessage: unknown = nestedError?.['message'];
    if (typeof nestedMessage === 'string' && nestedMessage.length > 0) {
      fallback.message = nestedMessage;
    }
    const nestedCode: unknown = nestedError?.['code'] ?? nestedError?.['type'];
    if (typeof nestedCode === 'string' && nestedCode.length > 0) {
      fallback.publicError = nestedCode;
    }

    // Normalizar rate limiting si no vino status
    const msg = fallback.message.toLowerCase();
    if (fallback.status === HttpStatus.INTERNAL_SERVER_ERROR) {
      if (msg.includes('rate limit') || msg.includes('429')) {
        fallback.status = HttpStatus.TOO_MANY_REQUESTS;
        fallback.publicError = 'RATE_LIMITED';
      }
      if (msg.includes('quota') || msg.includes('insufficient_quota')) {
        fallback.status = HttpStatus.PAYMENT_REQUIRED;
        fallback.publicError = 'QUOTA_EXCEEDED';
      }
    }

    return fallback;
  }

  /**
   * Elimina las entradas de conocimiento filtradas por source.
   * Útil para reingestar el knowledge-base.json sin afectar PDFs u otras fuentes.
   */
  async clearEntriesBySource(source: string): Promise<{ deleted: number }> {
    const result = await this.knowledgeRepo.delete({ source });
    const deleted = result.affected ?? 0;
    this.logger.warn(
      `🗑️ Se eliminaron ${deleted} entradas con source="${source}"`,
    );
    return { deleted };
  }

  /**
   * Verifica si existe un entry con el hash dado en metadata.
   * Usado para deduplicación durante la ingesta.
   */
  async existsByContentHash(hash: string): Promise<boolean> {
    const count = await this.knowledgeRepo
      .createQueryBuilder('k')
      .where(`k.metadata ->> 'contentHash' = :hash`, { hash })
      .getCount();
    return count > 0;
  }

  /**
   * Búsqueda híbrida: combina semántica (embeddings) + léxica (full-text).
   *
   * Pesos por defecto:
   * - 0.6 semántico: captura significado y parafraseo
   * - 0.4 léxico: captura términos exactos (leyes, siglas, velocidades)
   *
   * @param userQuery - Pregunta del usuario
   * @param limit - Cantidad máxima de resultados
   * @param semanticWeight - Peso para búsqueda semántica (0-1)
   */
  async searchKnowledge(
    userQuery: string,
    limit: number = 5,
  ): Promise<KnowledgeEntry[]> {
    const startTime = Date.now();
    const retrievalQuery = normalizeRagQuery(userQuery);

    if (retrievalQuery !== userQuery) {
      this.logger.debug(
        `🔎 Query normalizada para retrieval: "${userQuery}" -> "${retrievalQuery}"`,
      );
    }

    try {
      // Intentar obtener embedding desde cache
      const queryEmbedding =
        await this.getOrCacheQueryEmbedding(retrievalQuery);
      const embeddingString = `[${queryEmbedding.join(',')}]`;

      // Búsqueda híbrida con CTE (Common Table Expressions)
      // Convert cosine distance to similarity score (1 = identical)
      const results: HybridSearchResult[] = await this.knowledgeRepo.query(
        `
        WITH semantic_scores AS (
          SELECT 
            id,
            1 - (embedding <=> $1::vector) AS score
          FROM knowledge_entries
          WHERE embedding IS NOT NULL
        ),
        lexical_scores AS (
          SELECT 
            id,
            ts_rank_cd(search_vector, plainto_tsquery('spanish', $2)) AS score
          FROM knowledge_entries
          WHERE search_vector @@ plainto_tsquery('spanish', $2)
        ),
        lexical_normalized AS (
          SELECT 
            id,
            CASE 
              WHEN MAX(score) OVER () > 0 
              THEN score / MAX(score) OVER ()
              ELSE 0 
            END AS score
          FROM lexical_scores
        )
        SELECT 
          k.id,
          k.content,
          k.source,
          k.metadata,
          k."createdAt",
          (COALESCE(s.score, 0) * $4 + COALESCE(l.score, 0) * $5) AS hybrid_score
        FROM knowledge_entries k
        LEFT JOIN semantic_scores s ON k.id = s.id
        LEFT JOIN lexical_normalized l ON k.id = l.id
        WHERE COALESCE(s.score, 0) > 0 OR COALESCE(l.score, 0) > 0
        ORDER BY hybrid_score DESC
        LIMIT $3
        `,
        [
          embeddingString,
          retrievalQuery,
          limit,
          this.semanticWeight,
          this.lexicalWeight,
        ],
      );

      // Métricas RAG para debugging y monitoreo
      const elapsed = Date.now() - startTime;
      const topScore = results[0]?.hybrid_score ?? 0;
      this.logger.debug(
        `📊 RAG: ${results.length} docs, top_score=${topScore.toFixed(3)}, elapsed=${elapsed}ms`,
      );

      return results.map((r) => ({
        id: r.id,
        content: r.content,
        source: r.source,
        metadata: r.metadata,
        createdAt: r.createdAt,
      })) as KnowledgeEntry[];
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error in hybrid search: ${err.message}`, err.stack);
      // Fallback a búsqueda solo semántica si híbrida falla
      return this.searchSemanticOnly(retrievalQuery, limit);
    }
  }

  /**
   * Búsqueda solo semántica (fallback si híbrida falla).
   */
  private async searchSemanticOnly(
    userQuery: string,
    limit: number,
  ): Promise<KnowledgeEntry[]> {
    try {
      const retrievalQuery = normalizeRagQuery(userQuery);
      const queryEmbedding =
        await this.embeddingsModel.embedQuery(retrievalQuery);
      const embeddingString = `[${queryEmbedding.join(',')}]`;

      return await this.knowledgeRepo
        .createQueryBuilder('k')
        .orderBy(`k.embedding <=> :embedding`)
        .setParameters({ embedding: embeddingString })
        .limit(limit)
        .getMany();
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Fallback search failed: ${err.message}`, err.stack);
      return [];
    }
  }

  /**
   * Obtiene el embedding de una query, usando cache para queries frecuentes.
   * TTL de 1 hora - queries como "velocidad máxima" se repiten mucho.
   */
  private async getOrCacheQueryEmbedding(query: string): Promise<number[]> {
    const normalizedQuery = normalizeRagQuery(query);
    const cacheKey = `emb:${normalizedQuery.toLowerCase().trim()}`;
    const cached = await this.cacheManager.get<number[]>(cacheKey);

    if (cached) {
      this.logger.debug(
        `🎯 Cache hit para embedding: "${normalizedQuery.slice(0, 30)}..."`,
      );
      return cached;
    }

    const embedding = await this.embeddingsModel.embedQuery(normalizedQuery);

    // Cache por 1 hora (3600 segundos)
    await this.cacheManager.set(cacheKey, embedding, 3600 * 1000);

    return embedding;
  }

  /**
   * Re-rankea una lista de documentos candidatos usando un cross-encoder de HuggingFace.
   * Siempre intenta llamar al reranker — la decisión de habilitarlo es del llamador.
   * Si falla o excede el timeout, devuelve los candidatos en su orden original (top K).
   */
  async rerankResults(
    query: string,
    candidates: KnowledgeEntry[],
  ): Promise<KnowledgeEntry[]> {
    if (!this.hfApiKey || candidates.length === 0) {
      return candidates.slice(0, RERANKER_TOP_K);
    }

    try {
      const rerankQuery = normalizeRagQuery(query);
      const documents = candidates.map((doc) => doc.content);

      const response = await axios.post<
        Array<Array<{ label: string; score: number }>>
      >(
        this.rerankerEndpoint,
        {
          inputs: documents.map((doc) => ({
            text: rerankQuery,
            text_pair: doc,
          })),
        },
        {
          headers: {
            Authorization: `Bearer ${this.hfApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: RERANKER_TIMEOUT_MS,
        },
      );

      const results = response.data;

      if (
        !Array.isArray(results) ||
        results.length === 0 ||
        !Array.isArray(results[0])
      ) {
        this.logger.warn(
          `⚠️ Reranker devolvió respuesta vacía/inválida. Usando orden original.`,
        );
        return candidates.slice(0, RERANKER_TOP_K);
      }

      const scores = results[0];

      if (scores.length !== candidates.length) {
        this.logger.warn(
          `⚠️ Reranker devolvió distinta cantidad de scores (${scores.length}) que candidatos (${candidates.length}). Usando orden original.`,
        );
        return candidates.slice(0, RERANKER_TOP_K);
      }

      const ranked = candidates
        .map((doc, index) => ({ doc, score: scores[index].score }))
        .sort((a, b) => b.score - a.score)
        .map((r) => r.doc)
        .slice(0, RERANKER_TOP_K);

      this.logger.debug(
        `🔀 Reranker completado: top K=${ranked.length} (top score=${scores.sort((a, b) => b.score - a.score)[0]?.score?.toFixed(3) ?? 0})`,
      );

      return ranked;
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `⚠️ Reranker falló (fallback a orden original): ${err.message}`,
      );
      return candidates.slice(0, RERANKER_TOP_K);
    }
  }

  async ask(userQuery: string): Promise<string> {
    const { docs } = await this.retrieveAndRerank(userQuery);

    if (docs.length === 0) {
      return 'Lo siento, no tengo información sobre eso en mis manuales. 🤷‍♂️';
    }

    const contextText = docs
      .map((doc) => `[FUENTE: ${doc.source}] ${doc.content}`)
      .join('\n\n');

    return this.generateResponse(userQuery, contextText);
  }

  /**
   * Versión de ask() que también expone el contexto recuperado.
   * Usada por el endpoint /ask-with-context para evaluaciones LLM-as-judge.
   */
  async askWithContext(
    userQuery: string,
  ): Promise<{ answer: string; context: KnowledgeEntry[] }> {
    const { docs } = await this.retrieveAndRerank(userQuery);

    if (docs.length === 0) {
      return {
        answer: 'Lo siento, no tengo información sobre eso en mis manuales. 🤷‍♂️',
        context: [],
      };
    }

    const contextText = docs
      .map((doc) => `[FUENTE: ${doc.source}] ${doc.content}`)
      .join('\n\n');

    const answer = await this.generateResponse(userQuery, contextText);
    return { answer, context: docs };
  }

  /**
   * Búsqueda con reranking — para evaluación y debugging.
   * Siempre reranquea (ignora RERANKER_ENABLED) para poder medir el impacto real.
   */
  async searchReranked(userQuery: string): Promise<KnowledgeEntry[]> {
    const candidates = await this.searchKnowledge(
      userQuery,
      RERANKER_CANDIDATE_COUNT,
    );
    return this.rerankResults(userQuery, candidates);
  }

  /**
   * Paso de búsqueda + reranking compartido entre ask() y askWithContext().
   * Respeta RERANKER_ENABLED: si es false, devuelve los top-5 del hybrid search directo.
   */
  private async retrieveAndRerank(
    userQuery: string,
  ): Promise<{ docs: KnowledgeEntry[] }> {
    if (!this.rerankerEnabled) {
      const docs = await this.searchKnowledge(userQuery, RERANKER_TOP_K);
      return { docs };
    }

    const candidates = await this.searchKnowledge(
      userQuery,
      RERANKER_CANDIDATE_COUNT,
    );
    const docs = await this.rerankResults(userQuery, candidates);
    return { docs };
  }

  private async generateResponse(
    userQuery: string,
    contextText: string,
  ): Promise<string> {
    const promptTemplate =
      PromptTemplate.fromTemplate(`Sos un instructor experto de la "Autoescuela GMC" con presencia en Villa Gesell y Pinamar, Buenos Aires, cuyo fundador e instructor principal es Guido Cucco.

REGLA CRÍTICA - ALCANCE DEL ASISTENTE:
- SOLO respondés sobre temas relacionados a: conducción, teoría vial, trámites de licencia, documentación, normativa de tránsito y gestiones administrativas de la autoescuela.
- Si te preguntan sobre temas NO relacionados (comida, recetas, deportes, entretenimiento, etc.), respondé ÚNICAMENTE: "Disculpá, solo puedo ayudarte con temas relacionados a la autoescuela y teoría de conducir. 🚗"
- Antes de responder, evaluá si la pregunta está dentro del alcance. Si no lo está, usá el mensaje anterior sin importar qué contexto se recuperó.

REGLA CRÍTICA DE LOCALIDAD:
- Por defecto, SIEMPRE respondé con información de VILLA GESELL.
- Solo mencioná info de Pinamar u otras localidades si el alumno pregunta ESPECÍFICAMENTE por esa localidad.
- Si el alumno pregunta algo genérico (ej: "¿dónde saco la licencia?"), respondé con los datos de Villa Gesell.
  
Tu base de conocimiento tiene 3 niveles de prioridad:
1. "Reglas Locales / Actualizaciones" (FUENTE: knowledge-base.json): ESTO ES LA VERDAD ABSOLUTA. Si contradice a los manuales, hacé caso a esto (ej: Cédula Azul derogada, reglas de playa).
2. "Preguntas Examen" (FUENTE: bateria_preguntas): Usalo para dar respuestas precisas de test.
3. "Manual PBA / Ley Nacional" (FUENTE: manual_pba / cnev_nacional): Usalo para explicaciones generales (el relleno).

Contexto recuperado:
{context}

Pregunta del Alumno:
{question}

Instrucciones:
- Respondé de forma corta, amable y directa (como por WhatsApp).
- NO uses saludos al inicio (ej: "Hola", "Buenos días"), andá directo a la respuesta, ya que el usuario ya fue saludado.
- Si hay conflicto entre fuentes, SIEMPRE ganan las Reglas Locales.
- Si hay info de varias localidades, priorizá VILLA GESELL salvo que pregunten por otra.
- Si no sabés (pero está dentro del alcance de conducción/autoescuela), decí "No estoy seguro, mejor consultalo con tu instructor 🏢".
- Usá español rioplatense (vos, tenés, manejás).`);

    const chain = promptTemplate
      .pipe(this.chatModel)
      .pipe(new StringOutputParser());

    const response = await chain.invoke({
      context: contextText,
      question: userQuery,
    });

    return response;
  }
}
