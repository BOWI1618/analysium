-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "projects_parentId_idx" ON "projects"("parentId");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

