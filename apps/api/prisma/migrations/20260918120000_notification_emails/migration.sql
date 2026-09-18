-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastNotificationEmailAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notifications_readAt_emailedAt_createdAt_idx" ON "notifications"("readAt", "emailedAt", "createdAt");

-- Notifications from before e-mail existed are not news any more: without this
-- the first digest after the upgrade would mail out an old backlog.
UPDATE "notifications" SET "emailedAt" = CURRENT_TIMESTAMP;
