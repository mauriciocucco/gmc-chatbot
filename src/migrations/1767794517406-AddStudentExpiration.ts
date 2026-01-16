import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStudentExpiration1767794517406 implements MigrationInterface {
  name = 'AddStudentExpiration1767794517406';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" ADD "accessExpiresAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN "accessExpiresAt"`,
    );
  }
}
