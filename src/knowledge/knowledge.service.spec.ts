import { ConfigService } from '@nestjs/config';
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeService', () => {
  const goodRow = {
    id: 'good-row',
    content:
      'Documento: Manual Oficial Provincia BSAS\nSeccion: LIMITES - Autopistas\n\nEn autopistas, la velocidad minima para motos y automoviles es 65 km/h y la maxima es 130 km/h.',
    source: 'manual_pba',
    metadata: {
      contentType: 'table-row',
      tableId: 'manual_pba_speed_limits',
      rowKey: 'autopista_motos_automoviles',
    },
    createdAt: new Date('2026-04-18T00:00:00.000Z'),
    hybrid_score: 0.99,
  };

  const badRow = {
    id: 'bad-row',
    content:
      'Documento: Manual Oficial Provincia BSAS\nSeccion: LIMITES\n\nautopistas Pasos a nivel sin barrera ni semaforo 130 km/h 100 km/h Id carreteras 20 km/h motos automoviles omnibus y autocasas restantes todos 65 km/h 10 km/h Calles Avenidas 60 km/h',
    source: 'manual_pba',
    metadata: { contentType: 'text' },
    createdAt: new Date('2026-04-18T00:00:00.000Z'),
    hybrid_score: 0.61,
  };

  let knowledgeRepo: { query: jest.Mock };
  let cacheManager: { get: jest.Mock; set: jest.Mock };
  let service: KnowledgeService;

  beforeEach(() => {
    knowledgeRepo = {
      query: jest.fn(),
    };

    cacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const configService = new ConfigService({
      RAG_SEMANTIC_WEIGHT: '0.6',
      EMBEDDING_DIMENSION: '1536',
      OPENAI_API_KEY: 'test-openai-key',
      OPENROUTER_API_KEY: 'test-openrouter-key',
      CHAT_MODEL: 'google/gemini-2.0-flash-lite-001',
      RERANKER_ENABLED: 'false',
    });

    service = new KnowledgeService(
      knowledgeRepo as never,
      configService,
      cacheManager as never,
    );

    jest
      .spyOn(service as never, 'getOrCacheQueryEmbedding')
      .mockResolvedValue([0.12, 0.34, 0.56] as never);
  });

  it('normaliza autoposta antes de consultar el retriever', async () => {
    knowledgeRepo.query.mockImplementation(
      async (_sql: string, params: unknown[]) => {
        const lexicalQuery = params[1];
        if (lexicalQuery === 'cuál es la velocidad mínima en autopista?') {
          return [goodRow, badRow];
        }

        return [badRow, goodRow];
      },
    );

    const results = await service.searchKnowledge(
      'cuál es la velocidad mínima en autoposta?',
      2,
    );

    expect(knowledgeRepo.query).toHaveBeenCalledTimes(1);
    expect(knowledgeRepo.query.mock.calls[0][1][1]).toBe(
      'cuál es la velocidad mínima en autopista?',
    );
    expect(results[0]?.content).toContain('65 km/h');
  });
});
