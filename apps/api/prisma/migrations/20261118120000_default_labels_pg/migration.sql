-- «ПГ» mark on a task: tinted in lists and on the board.
ALTER TABLE "issues" ADD COLUMN "isPg" BOOLEAN NOT NULL DEFAULT false;

-- Labels every project carries (DEFAULT_LABELS in domain/issueRules.ts).
-- A project that already has a label of that name keeps its own.
INSERT INTO "labels" ("id", "projectId", "name", "color", "createdAt")
SELECT gen_random_uuid()::text, p."id", l."name", l."color", CURRENT_TIMESTAMP
FROM "projects" p
CROSS JOIN (VALUES ('МБО', '#0083ca'), ('ДИ', '#283a97')) AS l("name", "color")
ON CONFLICT ("projectId", "name") DO NOTHING;
