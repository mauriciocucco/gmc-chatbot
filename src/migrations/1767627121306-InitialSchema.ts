import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1767627121306 implements MigrationInterface {
  name = 'InitialSchema1767627121306';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Activar extensión vectorial
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // 2. Tabla STUDENTS
    await queryRunner.query(
      `CREATE TABLE "students" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(), 
        "name" character varying(50), 
        "phoneNumber" character varying NOT NULL, 
        "accessExpiresAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(), 
        "isActive" boolean NOT NULL DEFAULT true, 
        CONSTRAINT "UQ_phone_number" UNIQUE ("phoneNumber"), 
        CONSTRAINT "PK_students" PRIMARY KEY ("id")
      )`,
    );

    // 3. Enum para Pasos de Conversación (Actualizado y Simplificado)
    await queryRunner.query(
      `CREATE TYPE "public"."conversations_step_enum" AS ENUM('WELCOME', 'MENU', 'LEARNING', 'FINISHED')`,
    );

    // 4. Tabla CONVERSATIONS
    await queryRunner.query(
      `CREATE TABLE "conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(), 
        "step" "public"."conversations_step_enum" NOT NULL DEFAULT 'WELCOME', 
        "context" jsonb NOT NULL DEFAULT '{}', 
        "isActive" boolean NOT NULL DEFAULT true, 
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(), 
        "lastInteractionAt" TIMESTAMP NOT NULL DEFAULT now(), 
        "studentId" uuid, 
        CONSTRAINT "PK_conversations" PRIMARY KEY ("id")
      )`,
    );

    // 5. Tabla KNOWLEDGE_ENTRIES (Antes exam_questions)
    await queryRunner.query(
      `CREATE TABLE "knowledge_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(), 
        "content" text NOT NULL, 
        "source" character varying NOT NULL, 
        "metadata" jsonb, 
        "embedding" vector(1536), 
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(), 
        CONSTRAINT "PK_knowledge_entries" PRIMARY KEY ("id")
      )`,
    );

    // 6. Relaciones (Foreign Keys)
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_conversations_student" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_conversations_student"`,
    );
    await queryRunner.query(`DROP TABLE "knowledge_entries"`);
    await queryRunner.query(`DROP TABLE "conversations"`);
    await queryRunner.query(`DROP TYPE "public"."conversations_step_enum"`);
    await queryRunner.query(`DROP TABLE "students"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS vector`);
  }
}
