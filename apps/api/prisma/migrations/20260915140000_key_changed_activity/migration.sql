-- AlterEnum
-- In a migration of its own: a new enum value cannot be used in the same
-- transaction that adds it, and the next migration writes it.
ALTER TYPE "ActivityType" ADD VALUE 'KEY_CHANGED';
