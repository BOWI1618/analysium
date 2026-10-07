-- CreateTable
CREATE TABLE "issue_templates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" JSONB,
    "type" "IssueType" NOT NULL DEFAULT 'TASK',
    "priority" "IssuePriority" NOT NULL DEFAULT 'MEDIUM',
    "dueInDays" INTEGER,
    "storyPoints" INTEGER,
    "recurrence" "IssueRecurrence",
    "subtasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "watcherIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issue_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "issue_templates_workspaceId_name_key" ON "issue_templates"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "issue_templates" ADD CONSTRAINT "issue_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

