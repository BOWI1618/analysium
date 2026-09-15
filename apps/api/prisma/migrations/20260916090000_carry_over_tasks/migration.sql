-- Open tasks whose day has passed can move to today; the task keeps count.
ALTER TABLE "issues" ADD COLUMN     "carriedOverDays" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "workspaces" ADD COLUMN     "carryOverTasks" BOOLEAN NOT NULL DEFAULT false;
