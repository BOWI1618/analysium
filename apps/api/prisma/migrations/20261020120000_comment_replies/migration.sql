-- A comment may answer another comment of the same task.
ALTER TABLE "comments" ADD COLUMN "replyToId" TEXT;

ALTER TABLE "comments" ADD CONSTRAINT "comments_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
