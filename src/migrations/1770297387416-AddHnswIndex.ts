import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración: Agregar índice HNSW para búsqueda vectorial rápida
 *
 * Problema: La búsqueda `embedding <=> vector` hace scan bruto O(n).
 * Solución: Índice HNSW (Hierarchical Navigable Small World) → O(log n)
 *
 * Parámetros:
 * - m=16: Conexiones por nodo (más = más preciso pero más memoria)
 * - ef_construction=64: Calidad del índice (más = mejor pero más lento de construir)
 *
 * Requiere: pgvector extension >= 0.5.0
 *
 * NOTA: transaction = false porque CREATE INDEX CONCURRENTLY no puede
 * ejecutarse dentro de una transacción.
 */
export class AddHnswIndex1770297387416 implements MigrationInterface {
  // Deshabilitar transacción para permitir CREATE INDEX CONCURRENTLY
  transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Verificar que pgvector soporta HNSW (>= 0.5.0)
    const versionResult = (await queryRunner.query(`
      SELECT extversion FROM pg_extension WHERE extname = 'vector';
    `)) as Array<{ extversion: string }>;

    const version: string = versionResult?.[0]?.extversion ?? '0.0.0';
    const [major, minor] = version.split('.').map(Number);

    if (major === 0 && minor < 5) {
      console.warn(
        `⚠️ pgvector ${version} no soporta HNSW (requiere >= 0.5.0). ` +
          `Saltando creación de índice HNSW.`,
      );
      return;
    }

    // Crear índice HNSW para búsqueda vectorial coseno
    // Nota: vector_cosine_ops porque usamos distancia coseno (<=>)
    // CONCURRENTLY: no bloquea escrituras durante la creación (seguro para prod)
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_embedding_hnsw_idx 
      ON knowledge_entries 
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    `);

    console.log('✅ Índice HNSW creado para knowledge_entries.embedding');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS knowledge_embedding_hnsw_idx;
    `);

    console.log('🗑️ Índice HNSW eliminado');
  }
}
