-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "projects_workspaceId_isSystem_idx" ON "projects"("workspaceId", "isSystem");

