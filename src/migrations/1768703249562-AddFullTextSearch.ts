import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración: Agregar soporte para búsqueda full-text (RAG híbrido)
 *
 * Esta migración agrega:
 * 1. Columna `search_vector` (tsvector) para búsqueda léxica
 * 2. Índice GIN para búsquedas rápidas
 * 3. Trigger para actualización automática del vector
 *
 * Esto permite RAG híbrido: semántico (embeddings) + léxico (BM25-like)
 */
export class AddFullTextSearch1768703249562 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Agregar columna tsvector para full-text search
    await queryRunner.query(`
      ALTER TABLE knowledge_entries 
      ADD COLUMN IF NOT EXISTS search_vector tsvector;
    `);

    // 2. Crear índice GIN para búsquedas rápidas
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_search_vector 
      ON knowledge_entries USING GIN(search_vector);
    `);

    // 3. Crear función para actualizar el search_vector automáticamente
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_knowledge_search_vector()
      RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('spanish', COALESCE(NEW.content, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 4. Crear trigger que se ejecuta en INSERT o UPDATE
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_knowledge_search_vector ON knowledge_entries;
      CREATE TRIGGER trg_knowledge_search_vector
      BEFORE INSERT OR UPDATE OF content ON knowledge_entries
      FOR EACH ROW EXECUTE FUNCTION update_knowledge_search_vector();
    `);

    // 5. Poblar search_vector para registros existentes
    await queryRunner.query(`
      UPDATE knowledge_entries 
      SET search_vector = to_tsvector('spanish', COALESCE(content, ''))
      WHERE search_vector IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revertir en orden inverso
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_knowledge_search_vector ON knowledge_entries;
    `);

    await queryRunner.query(`
      DROP FUNCTION IF EXISTS update_knowledge_search_vector();
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_knowledge_search_vector;
    `);

    await queryRunner.query(`
      ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS search_vector;
    `);
  }
}
