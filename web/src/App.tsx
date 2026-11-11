import { lazy } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { Layout } from '@/components/Layout';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RouteBoundary } from '@/components/RouteBoundary';
import { PageMetadata } from '@/components/PageMetadata';
import { Skeleton } from '@/components/ui/skeleton';

const Playground = lazy(() =>
  import('@/routes/Playground').then((module) => ({ default: module.Playground }))
);
const Demo = lazy(() => import('@/routes/Demo').then((module) => ({ default: module.Demo })));
const Login = lazy(() => import('@/routes/Login').then((module) => ({ default: module.Login })));
const VerifyEmail = lazy(() =>
  import('@/routes/VerifyEmail').then((module) => ({ default: module.VerifyEmail }))
);
const Dashboard = lazy(() => import('@/routes/Dashboard').then((module) => ({ default: module.Dashboard })));
const Accounts = lazy(() => import('@/routes/Accounts').then((module) => ({ default: module.Accounts })));
const Transfer = lazy(() => import('@/routes/Transfer').then((module) => ({ default: module.Transfer })));
const Transactions = lazy(() =>
  import('@/routes/Transactions').then((module) => ({ default: module.Transactions }))
);
const Ledger = lazy(() => import('@/routes/Ledger').then((module) => ({ default: module.Ledger })));
const Admin = lazy(() => import('@/routes/Admin').then((module) => ({ default: module.Admin })));

/** Blocks the app shell until the stored session has been checked with the server. */
function RequireAuth() {
  const { user, ready } = useAuth();

  if (!ready) {
    return (
      <div className="bg-background flex h-dvh items-center justify-center">
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }

  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function RequireAdmin() {
  const { isAdmin, ready } = useAuth();
  if (!ready) return null;
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <PageMetadata />
      <AuthProvider>
        <TooltipProvider delayDuration={200}>
          <Routes>
            <Route
              path="/login"
              element={
                <RouteBoundary fullPage>
                  <Login />
                </RouteBoundary>
              }
            />
            <Route
              path="/demo"
              element={
                <RouteBoundary fullPage>
                  <Demo />
                </RouteBoundary>
              }
            />
            {/* Public: the link is opened from a mail client, where the
                recipient is usually not signed in. */}
            <Route
              path="/verify-email"
              element={
                <RouteBoundary fullPage>
                  <VerifyEmail />
                </RouteBoundary>
              }
            />
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="playground" element={<Playground />} />
                <Route path="accounts" element={<Accounts />} />
                <Route path="transfer" element={<Transfer />} />
                <Route path="transactions" element={<Transactions />} />
                <Route path="ledger" element={<Ledger />} />
                <Route element={<RequireAdmin />}>
                  <Route path="admin" element={<Admin />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
