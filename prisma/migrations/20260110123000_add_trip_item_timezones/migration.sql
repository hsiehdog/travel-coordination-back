-- AlterTable
ALTER TABLE "trip_items" ADD COLUMN IF NOT EXISTS "start_timezone" TEXT;
ALTER TABLE "trip_items" ADD COLUMN IF NOT EXISTS "end_timezone" TEXT;
