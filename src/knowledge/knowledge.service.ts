import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeEntry } from './entities/knowledge-entry.entity';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { PromptTemplate } from '@langchain/core/prompts';

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
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private embeddingsModel: OpenAIEmbeddings;
  private chatModel: ChatOpenAI;

  constructor(
    @InjectRepository(KnowledgeEntry)
    private readonly knowledgeRepo: Repository<KnowledgeEntry>,
    private readonly configService: ConfigService,
  ) {
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
      apiKey: openRouterKey, // Usar 'apiKey' (estándar nuevo) en vez de 'openAIApiKey'
      modelName: chatModel,
      temperature: 0.3,
      maxTokens: 300,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://autoescuela-gmc.com',
          'X-Title': 'Autoescuela GMC Bot',
          // Forzar header de autorización por si la librería falla
          Authorization: `Bearer ${openRouterKey}`,
        },
      },
    });

    this.logger.log(`🧠 Chat model configurado: ${chatModel}`);
  }

  async addKnowledgeEntry(
    content: string,
    source: string,
    metadata: Record<string, any> = {},
  ): Promise<KnowledgeEntry> {
    try {
      const embedding = await this.embeddingsModel.embedQuery(content);
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

  async searchKnowledge(
    userQuery: string,
    limit: number = 5,
  ): Promise<KnowledgeEntry[]> {
    try {
      const queryEmbedding = await this.embeddingsModel.embedQuery(userQuery);
      const embeddingString = `[${queryEmbedding.join(',')}]`;
      const results = await this.knowledgeRepo
        .createQueryBuilder('k')
        .orderBy(`k.embedding <-> :embedding`)
        .setParameters({ embedding: embeddingString })
        .limit(limit)
        .getMany();

      return results;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error searching knowledge: ${err.message}`, err.stack);
      return [];
    }
  }

  async ask(userQuery: string): Promise<string> {
    // Buscamos en la nueva tabla unificada
    const relevantDocs = await this.searchKnowledge(userQuery);

    if (relevantDocs.length === 0) {
      return 'Lo siento, no tengo información sobre eso en mis manuales. 🤷‍♂️';
    }

    const contextText = relevantDocs
      .map((doc) => `[FUENTE: ${doc.source}] ${doc.content}`)
      .join('\n\n');

    return this.generateResponse(userQuery, contextText);
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
1. "Reglas Locales / Actualizaciones" (FUENTE: reglas_locales): ESTO ES LA VERDAD ABSOLUTA. Si contradice a los manuales, hacé caso a esto (ej: Cédula Azul derogada, reglas de playa).
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
