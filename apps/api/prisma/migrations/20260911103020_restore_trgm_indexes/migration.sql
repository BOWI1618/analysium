-- CreateIndex
CREATE INDEX "issues_title_idx" ON "issues" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "issues_descriptionText_idx" ON "issues" USING GIN ("descriptionText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "projects_name_idx" ON "projects" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_name_idx" ON "users" USING GIN ("name" gin_trgm_ops);
