import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropExamQuestions1768225000000 implements MigrationInterface {
  name = 'DropExamQuestions1768225000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "exam_questions"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // En caso de revertir, habría que recrear la tabla, pero es mejor
    // asumir que si volvemos atrás es a la migración anterior.
    // Por completitud, podemos poner la definición básica:
    await queryRunner.query(
      `CREATE TABLE "exam_questions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "question" text NOT NULL, "answer" text NOT NULL, "category" character varying, "embedding" vector, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a214d47c7964cb6356f413dc73c" PRIMARY KEY ("id"))`,
    );
  }
}
