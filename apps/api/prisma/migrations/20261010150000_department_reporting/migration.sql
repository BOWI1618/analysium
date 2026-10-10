-- AlterTable
ALTER TABLE "department_members" ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "position" TEXT;

-- CreateIndex
CREATE INDEX "department_members_managerId_idx" ON "department_members"("managerId");

-- AddForeignKey
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "department_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

