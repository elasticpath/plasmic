import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIsOrgStarter1740067200000 implements MigrationInterface {
  name = "AddIsOrgStarter1740067200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project" ADD COLUMN "isOrgStarter" boolean`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project" DROP COLUMN "isOrgStarter"`
    );
  }
}
