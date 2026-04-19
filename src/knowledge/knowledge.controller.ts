import { Controller, Post, Body, Get, Query, Delete } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  /**
   * Elimina las entradas de conocimiento de un source específico.
   * Ejemplo: DELETE /knowledge/clear?source=knowledge-base.json
   */
  @Delete('clear')
  async clearBySource(
    @Query('source') source: string,
  ): Promise<{ deleted: number }> {
    if (!source) {
      throw new Error('El parámetro "source" es requerido');
    }
    return this.knowledgeService.clearEntriesBySource(source);
  }

  // Nuevo endpoint para cargar documentos/reglas: POST /knowledge/add-entry
  @Post('add-entry')
  async addEntry(
    @Body()
    body: {
      content: string;
      source: string;
      metadata?: Record<string, any>;
    },
  ) {
    return await this.knowledgeService.addKnowledgeEntry(
      body.content,
      body.source,
      body.metadata,
    );
  }

  // Endpoint para probar búsqueda: GET /knowledge/search?q=...&limit=10
  @Get('search')
  async search(@Query('q') query: string, @Query('limit') limit?: string) {
    const parsedLimit =
      limit !== undefined && !isNaN(parseInt(limit, 10))
        ? parseInt(limit, 10)
        : undefined;

    return this.knowledgeService.searchKnowledge(query, parsedLimit);
  }

  /**
   * Verifica si un contenido ya existe en la DB por su hash.
   * Usado por el script de ingesta para evitar duplicados.
   * GET /knowledge/exists?hash=abc123
   */
  @Get('exists')
  async existsByHash(
    @Query('hash') hash: string,
  ): Promise<{ exists: boolean }> {
    const exists = await this.knowledgeService.existsByContentHash(hash);
    return { exists };
  }

  /**
   * Responde una pregunta y expone el contexto recuperado.
   * Usado por el script de evaluación LLM-as-judge (eval:answers).
   * GET /knowledge/ask-with-context?q=...
   */
  @Get('ask-with-context')
  async askWithContext(
    @Query('q') query: string,
  ): Promise<{
    question: string;
    answer: string;
    context: Array<{ id: string; content: string; source: string }>;
  }> {
    const { answer, context } =
      await this.knowledgeService.askWithContext(query);
    return {
      question: query,
      answer,
      context: context.map((c) => ({
        id: c.id,
        content: c.content,
        source: c.source,
      })),
    };
  }
}
