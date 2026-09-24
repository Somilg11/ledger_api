import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Layout } from '@/components/Layout';
import { Login } from '@/routes/Login';
import { VerifyEmail } from '@/routes/VerifyEmail';
import { Dashboard } from '@/routes/Dashboard';
import { Accounts } from '@/routes/Accounts';
import { Transfer } from '@/routes/Transfer';
import { Transactions } from '@/routes/Transactions';
import { Ledger } from '@/routes/Ledger';
import { Admin } from '@/routes/Admin';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';

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
      <AuthProvider>
        <TooltipProvider delayDuration={200}>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Public: the link is opened from a mail client, where the
                recipient is usually not signed in. */}
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
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
