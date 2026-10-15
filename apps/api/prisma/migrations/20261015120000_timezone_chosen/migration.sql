-- The saved zone follows the browser until the person picks one. A zone other
-- than the default was picked by hand, so it stays.
ALTER TABLE "users" ADD COLUMN "timezoneChosen" BOOLEAN NOT NULL DEFAULT false;
UPDATE "users" SET "timezoneChosen" = true WHERE "timezone" <> 'UTC';
