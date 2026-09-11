-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'GUEST');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('KANBAN', 'SCRUM', 'SIMPLE');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('LEAD', 'CONTRIBUTOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "StatusCategory" AS ENUM ('BACKLOG', 'UNSTARTED', 'STARTED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('TASK', 'BUG', 'STORY', 'EPIC', 'SUBTASK');

-- CreateEnum
CREATE TYPE "IssuePriority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('ISSUE_CREATED', 'STATUS_CHANGED', 'ASSIGNEE_CHANGED', 'PRIORITY_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED', 'TYPE_CHANGED', 'LABEL_ADDED', 'LABEL_REMOVED', 'DUE_DATE_CHANGED', 'STORY_POINTS_CHANGED', 'EPIC_CHANGED', 'SPRINT_CHANGED', 'PARENT_CHANGED', 'SUBTASK_CREATED', 'COMMENT_ADDED', 'COMMENT_DELETED', 'ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED', 'ISSUE_ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ISSUE_ASSIGNED', 'ISSUE_MENTIONED', 'ISSUE_STATUS_CHANGED', 'ISSUE_COMMENTED', 'ISSUE_DUE_SOON', 'ISSUE_DUE_DATE_CHANGED', 'ISSUE_UNASSIGNED', 'SPRINT_STARTED', 'SPRINT_COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "passwordHash" TEXT,
    "authProvider" TEXT NOT NULL DEFAULT 'local',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT '📦',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "leadId" TEXT,
    "projectType" "ProjectType" NOT NULL DEFAULT 'KANBAN',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "issueCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'CONTRIBUTOR',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_statuses" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StatusCategory" NOT NULL DEFAULT 'UNSTARTED',
    "color" TEXT NOT NULL DEFAULT '#94a3b8',
    "position" INTEGER NOT NULL DEFAULT 0,
    "wipLimit" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNED',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "committedPoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "issueKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" JSONB,
    "descriptionText" TEXT,
    "type" "IssueType" NOT NULL DEFAULT 'TASK',
    "statusId" TEXT NOT NULL,
    "priority" "IssuePriority" NOT NULL DEFAULT 'MEDIUM',
    "reporterId" TEXT,
    "assigneeId" TEXT,
    "parentId" TEXT,
    "epicId" TEXT,
    "sprintId" TEXT,
    "storyPoints" INTEGER,
    "dueDate" TIMESTAMP(3),
    "rank" TEXT NOT NULL DEFAULT 'U',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_labels" (
    "issueId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "issue_labels_pkey" PRIMARY KEY ("issueId","labelId")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "bodyText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "issueId" TEXT,
    "commentId" TEXT,
    "uploaderId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "ActivityType" NOT NULL,
    "field" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "issueId" TEXT,
    "commentId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" TEXT NOT NULL DEFAULT 'LIST',
    "filters" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspaces_ownerId_idx" ON "workspaces"("ownerId");

-- CreateIndex
CREATE INDEX "workspace_members_userId_idx" ON "workspace_members"("userId");

-- CreateIndex
CREATE INDEX "workspace_members_workspaceId_role_idx" ON "workspace_members"("workspaceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_key" ON "workspace_members"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_workspaceId_email_key" ON "invitations"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "projects_workspaceId_isArchived_idx" ON "projects"("workspaceId", "isArchived");

-- CreateIndex
CREATE INDEX "projects_leadId_idx" ON "projects"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_workspaceId_key_key" ON "projects"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "project_members_userId_idx" ON "project_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "project_members"("projectId", "userId");

-- CreateIndex
CREATE INDEX "workflow_statuses_projectId_position_idx" ON "workflow_statuses"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_statuses_projectId_name_key" ON "workflow_statuses"("projectId", "name");

-- CreateIndex
CREATE INDEX "labels_projectId_idx" ON "labels"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "labels_projectId_name_key" ON "labels"("projectId", "name");

-- CreateIndex
CREATE INDEX "sprints_projectId_status_idx" ON "sprints"("projectId", "status");

-- CreateIndex
CREATE INDEX "issues_projectId_statusId_rank_idx" ON "issues"("projectId", "statusId", "rank");

-- CreateIndex
CREATE INDEX "issues_projectId_updatedAt_idx" ON "issues"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "issues_projectId_createdAt_idx" ON "issues"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "issues_assigneeId_completedAt_idx" ON "issues"("assigneeId", "completedAt");

-- CreateIndex
CREATE INDEX "issues_reporterId_idx" ON "issues"("reporterId");

-- CreateIndex
CREATE INDEX "issues_sprintId_idx" ON "issues"("sprintId");

-- CreateIndex
CREATE INDEX "issues_epicId_idx" ON "issues"("epicId");

-- CreateIndex
CREATE INDEX "issues_parentId_idx" ON "issues"("parentId");

-- CreateIndex
CREATE INDEX "issues_statusId_idx" ON "issues"("statusId");

-- CreateIndex
CREATE INDEX "issues_priority_idx" ON "issues"("priority");

-- CreateIndex
CREATE INDEX "issues_dueDate_idx" ON "issues"("dueDate");

-- CreateIndex
CREATE INDEX "issues_updatedAt_idx" ON "issues"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "issues_projectId_number_key" ON "issues"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "issues_issueKey_key" ON "issues"("issueKey");

-- CreateIndex
CREATE INDEX "issue_labels_labelId_idx" ON "issue_labels"("labelId");

-- CreateIndex
CREATE INDEX "comments_issueId_createdAt_idx" ON "comments"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "comments_authorId_idx" ON "comments"("authorId");

-- CreateIndex
CREATE INDEX "attachments_issueId_idx" ON "attachments"("issueId");

-- CreateIndex
CREATE INDEX "attachments_commentId_idx" ON "attachments"("commentId");

-- CreateIndex
CREATE INDEX "activity_events_issueId_createdAt_idx" ON "activity_events"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_events_actorId_createdAt_idx" ON "activity_events"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_createdAt_idx" ON "audit_logs"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "saved_views_workspaceId_ownerId_idx" ON "saved_views"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "favorites_userId_idx" ON "favorites"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_userId_entityType_entityId_key" ON "favorites"("userId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_statuses" ADD CONSTRAINT "workflow_statuses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "workflow_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
