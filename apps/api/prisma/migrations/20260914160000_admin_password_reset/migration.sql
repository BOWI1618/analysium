-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordResetExpiresAt" TIMESTAMP(3),
ADD COLUMN     "passwordResetTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_passwordResetTokenHash_key" ON "users"("passwordResetTokenHash");

