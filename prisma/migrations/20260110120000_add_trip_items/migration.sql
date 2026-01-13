-- CreateEnum
CREATE TYPE "TripItemKind" AS ENUM ('FLIGHT', 'LODGING', 'MEETING', 'MEAL', 'TRANSPORT', 'ACTIVITY', 'NOTE', 'OTHER');

-- CreateTable
CREATE TABLE "trip_items" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "reconstruct_run_id" TEXT NOT NULL,
    "day_index" INTEGER NOT NULL,
    "day_label" TEXT NOT NULL,
    "day_local_date" TEXT,
    "item_index" INTEGER NOT NULL,
    "item_id" TEXT NOT NULL,
    "kind" "TripItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "start_local_date" TEXT,
    "start_local_time" TEXT,
    "start_timezone" TEXT,
    "start_iso" TEXT,
    "end_local_date" TEXT,
    "end_local_time" TEXT,
    "end_timezone" TEXT,
    "end_iso" TEXT,
    "location_text" TEXT,
    "is_inferred" BOOLEAN NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source_snippet" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_items_trip_id_created_at_idx" ON "trip_items"("trip_id", "created_at");

-- CreateIndex
CREATE INDEX "trip_items_reconstruct_run_id_idx" ON "trip_items"("reconstruct_run_id");

-- CreateIndex
CREATE INDEX "trip_items_trip_id_day_index_item_index_idx" ON "trip_items"("trip_id", "day_index", "item_index");

-- AddForeignKey
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_reconstruct_run_id_fkey" FOREIGN KEY ("reconstruct_run_id") REFERENCES "reconstruct_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
