import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateConversationEnum1767731660723 implements MigrationInterface {
  name = 'UpdateConversationEnum1767731660723';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."conversations_step_enum" RENAME TO "conversations_step_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."conversations_step_enum" AS ENUM('WELCOME', 'MENU', 'LEARNING', 'APPOINTMENT_DATE', 'APPOINTMENT_CONFIRM', 'FINISHED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ALTER COLUMN "step" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ALTER COLUMN "step" TYPE "public"."conversations_step_enum" USING "step"::"text"::"public"."conversations_step_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ALTER COLUMN "step" SET DEFAULT 'WELCOME'`,
    );
    await queryRunner.query(`DROP TYPE "public"."conversations_step_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."conversations_step_enum_old" AS ENUM('WELCOME', 'MENU', 'ASKING_DATE', 'CONFIRMATION', 'FINISHED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ALTER COLUMN "step" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ALTER COLUMN "step" TYPE "public"."conversations_step_enum_old" USING "step"::"text"::"public"."conversations_step_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ALTER COLUMN "step" SET DEFAULT 'WELCOME'`,
    );
    await queryRunner.query(`DROP TYPE "public"."conversations_step_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."conversations_step_enum_old" RENAME TO "conversations_step_enum"`,
    );
  }
}
