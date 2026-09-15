-- DropIndex
DROP INDEX "issues_projectId_number_key";

-- AlterTable
ALTER TABLE "issues" ADD COLUMN     "subNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subtaskCounter" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "issues_projectId_number_subNumber_key" ON "issues"("projectId", "number", "subNumber");

-- Existing subtasks are renumbered after their parent: WEB-7 under WEB-4
-- becomes WEB-4.1, in the order the subtasks were created.
CREATE TEMP TABLE "subtask_renumber" AS
SELECT
  s."id",
  s."parentId",
  s."issueKey" AS "oldKey",
  p."number" AS "parentNumber",
  ROW_NUMBER() OVER (PARTITION BY s."parentId" ORDER BY s."number") AS "subNumber",
  p."issueKey" || '.' || (ROW_NUMBER() OVER (PARTITION BY s."parentId" ORDER BY s."number"))::text AS "newKey"
FROM "issues" s
JOIN "issues" p ON p."id" = s."parentId"
WHERE p."parentId" IS NULL;

UPDATE "issues" i
SET "number" = r."parentNumber", "subNumber" = r."subNumber", "issueKey" = r."newKey"
FROM "subtask_renumber" r
WHERE i."id" = r."id";

UPDATE "issues" p
SET "subtaskCounter" = c."count"
FROM (SELECT "parentId", COUNT(*) AS "count" FROM "subtask_renumber" GROUP BY "parentId") c
WHERE p."id" = c."parentId";

-- Old keys keep opening the subtask: lookups fall back to this history entry.
INSERT INTO "activity_events" ("id", "issueId", "actorId", "type", "field", "fromValue", "toValue", "createdAt")
SELECT gen_random_uuid()::text, r."id", NULL, 'KEY_CHANGED', 'issueKey', r."oldKey", r."newKey", CURRENT_TIMESTAMP
FROM "subtask_renumber" r;

-- Task numbers continue from the highest one in use, no longer after the
-- numbers subtasks used to take.
UPDATE "projects" p
SET "issueCounter" = COALESCE((SELECT MAX(i."number") FROM "issues" i WHERE i."projectId" = p."id"), 0);

DROP TABLE "subtask_renumber";
