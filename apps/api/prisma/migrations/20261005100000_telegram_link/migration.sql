-- AlterEnum
ALTER TYPE "TokenPurpose" ADD VALUE 'TELEGRAM_LINK';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "telegramChatId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramChatId_key" ON "users"("telegramChatId");
