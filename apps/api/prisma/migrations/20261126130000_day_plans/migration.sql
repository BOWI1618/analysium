-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DAY_PLAN';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "dayPlanId" TEXT;

-- CreateTable
CREATE TABLE "day_plans" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "draft" JSONB NOT NULL,
    "publishedContent" JSONB,
    "publishedAt" TIMESTAMP(3),
    "mentionedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "day_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "day_plans_workspaceId_day_authorId_key" ON "day_plans"("workspaceId", "day", "authorId");
CREATE INDEX "notifications_dayPlanId_idx" ON "notifications"("dayPlanId");

-- AddForeignKey
ALTER TABLE "day_plans" ADD CONSTRAINT "day_plans_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "day_plans" ADD CONSTRAINT "day_plans_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_dayPlanId_fkey" FOREIGN KEY ("dayPlanId") REFERENCES "day_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
