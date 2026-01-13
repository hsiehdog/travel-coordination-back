/*
  Warnings:

  - You are about to drop the column `day_index` on the `trip_items` table. All the data in the column will be lost.
  - You are about to drop the column `day_label` on the `trip_items` table. All the data in the column will be lost.
  - You are about to drop the column `day_local_date` on the `trip_items` table. All the data in the column will be lost.
  - You are about to drop the column `end_timezone` on the `trip_items` table. All the data in the column will be lost.
  - You are about to drop the column `item_id` on the `trip_items` table. All the data in the column will be lost.
  - You are about to drop the column `item_index` on the `trip_items` table. All the data in the column will be lost.
  - You are about to drop the column `reconstruct_run_id` on the `trip_items` table. All the data in the column will be lost.
  - You are about to drop the column `start_timezone` on the `trip_items` table. All the data in the column will be lost.
  - You are about to drop the column `source_text` on the `trips` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[trip_id,fingerprint]` on the table `trip_items` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `fingerprint` to the `trip_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `trip_items` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TripItemState" AS ENUM ('PROPOSED', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TripItemSource" AS ENUM ('AI', 'USER', 'CALENDAR', 'EMAIL');

-- DropForeignKey
ALTER TABLE "trip_items" DROP CONSTRAINT "trip_items_reconstruct_run_id_fkey";

-- DropIndex
DROP INDEX "trip_items_reconstruct_run_id_idx";

-- DropIndex
DROP INDEX "trip_items_trip_id_created_at_idx";

-- DropIndex
DROP INDEX "trip_items_trip_id_day_index_item_index_idx";

-- AlterTable
ALTER TABLE "trip_items" DROP COLUMN "day_index",
DROP COLUMN "day_label",
DROP COLUMN "day_local_date",
DROP COLUMN "end_timezone",
DROP COLUMN "item_id",
DROP COLUMN "item_index",
DROP COLUMN "reconstruct_run_id",
DROP COLUMN "start_timezone",
ADD COLUMN     "fingerprint" TEXT NOT NULL,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "source" "TripItemSource" NOT NULL DEFAULT 'AI',
ADD COLUMN     "state" "TripItemState" NOT NULL DEFAULT 'PROPOSED',
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "is_inferred" SET DEFAULT false,
ALTER COLUMN "confidence" SET DEFAULT 0.0;

-- AlterTable
ALTER TABLE "trips" DROP COLUMN "source_text";

-- CreateIndex
CREATE INDEX "trip_items_trip_id_updated_at_idx" ON "trip_items"("trip_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "trip_items_trip_id_fingerprint_key" ON "trip_items"("trip_id", "fingerprint");
