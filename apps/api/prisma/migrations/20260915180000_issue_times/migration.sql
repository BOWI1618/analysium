-- AlterTable
ALTER TABLE "issues" ADD COLUMN     "dueHasTime" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startHasTime" BOOLEAN NOT NULL DEFAULT false;

