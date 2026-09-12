import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from '~/app/session';
import { AppShell } from '~/components/AppShell';
import { Spinner } from '~/ui/Spinner';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';
import { VerifyEmailPage } from './VerifyEmailPage';
import { AcceptInvitePage } from './AcceptInvitePage';
import { HomePage } from './HomePage';
import { MyWorkPage } from './MyWorkPage';
import { InboxPage } from './InboxPage';
import { ProjectsPage } from './ProjectsPage';
import { NewProjectPage } from './NewProjectPage';
import { NewWorkspacePage } from './NewWorkspacePage';
import { ProjectLayout } from './project/ProjectLayout';
import { BoardPage } from './project/BoardPage';
import { ListPage } from './project/ListPage';
import { BacklogPage } from './project/BacklogPage';
import { CalendarPage } from './project/CalendarPage';
import { GanttPage } from './project/GanttPage';
import { ProjectSettingsPage } from './project/ProjectSettingsPage';
import { IssuePage } from './IssuePage';
import { ProfilePage } from './ProfilePage';
import { WorkspaceSettingsPage } from './settings/WorkspaceSettingsPage';
import { AccountSettingsPage } from './settings/AccountSettingsPage';
import { NotFoundPage } from './NotFoundPage';

// The dashboard pulls in the charting code — load it only when opened.
const DashboardPage = lazy(() =>
  import('./project/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);

function FullScreenLoader() {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg">
      <Spinner className="size-6 text-accent" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/** Redirects anonymous visitors to sign-in, preserving where they were headed. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading, workspaces } = useSession();
  const location = useLocation();

  if (isLoading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // A signed-in account with no workspace must create one before anything else.
  if (workspaces.length === 0 && location.pathname !== '/workspaces/new') {
    return <Navigate to="/workspaces/new" replace />;
  }
  return <>{children}</>;
}

function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useSession();
  if (isLoading) return <FullScreenLoader />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfSignedIn>
              <LoginPage />
            </RedirectIfSignedIn>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfSignedIn>
              <RegisterPage />
            </RedirectIfSignedIn>
          }
        />
        {/* Both are reached from a link in an e-mail, so neither may require
            a session — an invited account does not even have a password yet. */}
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route
          path="/workspaces/new"
          element={
            <RequireAuth>
              <NewWorkspacePage />
            </RequireAuth>
          }
        />

        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="my-work" element={<MyWorkPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<NewProjectPage />} />

          <Route path="projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<BoardPage />} />
            <Route path="board" element={<BoardPage />} />
            <Route path="list" element={<ListPage />} />
            <Route path="backlog" element={<BacklogPage />} />
            <Route path="gantt" element={<GanttPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="settings" element={<ProjectSettingsPage />} />
          </Route>

          <Route path="issue/:issueKey" element={<IssuePage />} />
          <Route path="people/:userId" element={<ProfilePage />} />
          <Route path="settings/workspace" element={<WorkspaceSettingsPage />} />
          <Route path="settings/account" element={<AccountSettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
