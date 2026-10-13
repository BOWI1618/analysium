-- A person taken out of a workspace used to stay among the members of its
-- projects. The application removes those rows from now on; this takes out
-- the ones left behind: memberships of a project held by someone who is no
-- longer in the project's workspace.
DELETE FROM "project_members" AS pm
USING "projects" AS p
WHERE pm."projectId" = p."id"
  AND NOT EXISTS (
    SELECT 1
    FROM "workspace_members" AS wm
    WHERE wm."workspaceId" = p."workspaceId"
      AND wm."userId" = pm."userId"
  );
