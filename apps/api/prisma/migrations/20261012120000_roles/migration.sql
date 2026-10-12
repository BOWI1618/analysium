-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('WORKSPACE', 'PROJECT');

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "customRoleId" TEXT;

-- AlterTable
ALTER TABLE "project_members" ADD COLUMN     "customRoleId" TEXT;

-- AlterTable
ALTER TABLE "workspace_members" ADD COLUMN     "customRoleId" TEXT;

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" "RoleScope" NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "allProjects" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_workspaceId_scope_name_key" ON "roles"("workspaceId", "scope", "name");

-- CreateIndex
CREATE INDEX "project_members_customRoleId_idx" ON "project_members"("customRoleId");

-- CreateIndex
CREATE INDEX "workspace_members_customRoleId_idx" ON "workspace_members"("customRoleId");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

