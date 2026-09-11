-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH', 'START_TO_FINISH');

-- DropIndex
DROP INDEX "issues_description_text_trgm_idx";

-- DropIndex
DROP INDEX "issues_title_trgm_idx";

-- DropIndex
DROP INDEX "projects_name_trgm_idx";

-- DropIndex
DROP INDEX "users_name_trgm_idx";

-- AlterTable
ALTER TABLE "issues" ADD COLUMN     "baselineDueDate" TIMESTAMP(3),
ADD COLUMN     "baselineStartDate" TIMESTAMP(3),
ADD COLUMN     "isMilestone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "issue_dependencies" (
    "id" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issue_dependencies_predecessorId_idx" ON "issue_dependencies"("predecessorId");

-- CreateIndex
CREATE INDEX "issue_dependencies_successorId_idx" ON "issue_dependencies"("successorId");

-- CreateIndex
CREATE UNIQUE INDEX "issue_dependencies_predecessorId_successorId_key" ON "issue_dependencies"("predecessorId", "successorId");

-- CreateIndex
CREATE INDEX "issues_projectId_startDate_dueDate_idx" ON "issues"("projectId", "startDate", "dueDate");

-- AddForeignKey
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
