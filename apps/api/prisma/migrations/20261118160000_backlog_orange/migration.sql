-- The backlog column is orange by default (DEFAULT_STATUSES in domain/issueRules.ts).
-- Only columns still in the old default grey change; a colour chosen by hand stays.
UPDATE "workflow_statuses" SET "color" = '#d97706' WHERE "category" = 'BACKLOG' AND lower("color") = '#9fb0c6';
