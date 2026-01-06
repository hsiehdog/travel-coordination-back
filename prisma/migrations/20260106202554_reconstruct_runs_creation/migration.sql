-- CreateEnum
CREATE TYPE "ReconstructStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "reconstruct_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ReconstructStatus" NOT NULL DEFAULT 'SUCCESS',
    "error_code" TEXT,
    "error_message" TEXT,
    "timezone" TEXT NOT NULL,
    "now_iso" TEXT,
    "raw_text" TEXT NOT NULL,
    "output_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconstruct_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconstruct_runs_user_id_created_at_idx" ON "reconstruct_runs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "reconstruct_runs" ADD CONSTRAINT "reconstruct_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
