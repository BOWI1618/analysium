-- Epics leave the product: a large piece of work is a task with subtasks.
-- What used to be an epic becomes an ordinary task, so that it can be given
-- subtasks like any other. Nothing is deleted: the link from a task to its
-- former epic stays in the data, it is only no longer shown.
UPDATE "issues" SET "type" = 'TASK' WHERE "type" = 'EPIC';
UPDATE "issue_templates" SET "type" = 'TASK' WHERE "type" = 'EPIC';
