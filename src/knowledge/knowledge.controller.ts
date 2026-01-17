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

  // Endpoint para probar búsqueda: GET /knowledge/search?q=...
  @Get('search')
  async search(@Query('q') query: string) {
    return this.knowledgeService.searchKnowledge(query);
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
}
