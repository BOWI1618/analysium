-- Deadline reminders: one more kind, and a key that keeps each sent once.
ALTER TYPE "NotificationType" ADD VALUE 'ISSUE_OVERDUE';

ALTER TABLE "notifications" ADD COLUMN "reminderKey" TEXT;

CREATE INDEX "notifications_issueId_reminderKey_idx" ON "notifications"("issueId", "reminderKey");
