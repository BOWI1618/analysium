-- Trigram indexes make case-insensitive substring search (ILIKE '%term%') on
-- issue titles and descriptions index-backed instead of a sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS issues_title_trgm_idx
  ON issues USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS issues_description_text_trgm_idx
  ON issues USING gin ("descriptionText" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS projects_name_trgm_idx
  ON projects USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_name_trgm_idx
  ON users USING gin (name gin_trgm_ops);

-- Partial index for the very common "open issues of a project" board query.
CREATE INDEX IF NOT EXISTS issues_active_board_idx
  ON issues ("projectId", "statusId", rank)
  WHERE "archivedAt" IS NULL AND "parentId" IS NULL;

-- Notification centre reads unread-first per user.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications ("userId", "createdAt" DESC)
  WHERE "readAt" IS NULL;
