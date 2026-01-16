import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKnowledgeEntry1768220000000 implements MigrationInterface {
  name = 'AddKnowledgeEntry1768220000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "knowledge_entries" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(), 
                "content" text NOT NULL, 
                "source" character varying NOT NULL, 
                "metadata" jsonb, 
                "embedding" vector(1536), 
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(), 
                CONSTRAINT "PK_knowledge_entries_id" PRIMARY KEY ("id")
            )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "knowledge_entries"`);
  }
}
