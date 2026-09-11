-- DropIndex
DROP INDEX "issues_issueKey_key";

-- CreateIndex
CREATE INDEX "issues_issueKey_idx" ON "issues"("issueKey");
