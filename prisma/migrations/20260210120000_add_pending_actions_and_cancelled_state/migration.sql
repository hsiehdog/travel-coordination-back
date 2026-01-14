-- CreateEnum
CREATE TYPE "PendingActionIntent" AS ENUM ('UPDATE', 'CANCEL', 'REPLACE', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "TripItemState" ADD VALUE 'CANCELLED';

-- CreateTable
CREATE TABLE "pending_actions" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "intent_type" "PendingActionIntent" NOT NULL DEFAULT 'UNKNOWN',
    "raw_update_text" TEXT NOT NULL,
    "candidates" JSONB NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_actions_trip_id_created_at_idx" ON "pending_actions"("trip_id", "created_at");

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
