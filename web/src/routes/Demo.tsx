import { LedgerLogo } from '@/components/LedgerLogo';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const scenarios = [
  {
    title: '1. Inspect the accounts',
    path: '/accounts',
    action: 'Compare balance, available balance, and ledger balance.',
    proof: 'The cached balance matches the journal. Each currency stays separate.',
  },
  {
    title: '2. Move money once, retry twice',
    path: '/transfer',
    action: 'Transfer ₹10 between two INR accounts. Send again with the same key and amount.',
    proof:
      'The same transaction returns. Only one debit occurs. Change the amount with the same key to see 409 Conflict.',
  },
  {
    title: '3. Reserve before settlement',
    path: '/transfer',
    action: 'Select Hold and reserve ₹5 between two INR accounts.',
    proof:
      'Available balance drops; balance and journal stay unchanged. Open Transactions to capture or void the pending hold.',
  },
  {
    title: '4. Read the evidence',
    path: '/transactions',
    action: 'Open the completed transaction, then inspect Ledger.',
    proof:
      'Two equal journal legs record the debit and credit. A capture writes them together; a void writes neither.',
  },
  {
    title: '5. Try a rejected payment',
    path: '/transfer',
    action:
      'Try an amount above the available balance. Notice that destination choices only include matching currencies.',
    proof: 'The API refuses the operation. No partial transfer or journal entry appears.',
  },
  {
    title: '6. Reconcile and reverse',
    path: '/admin',
    action: 'Sign out, sign in as Admin, verify the books, then reverse a completed transfer by its ID.',
    proof:
      'A new opposite transaction restores the money. The original becomes REVERSED; its journal remains. Admin also shows the audit trail.',
  },
];

export function Demo() {
  const { user, ready, isAdmin } = useAuth();
  const [status, setStatus] = useState('Checking API and databases…');

  useEffect(() => {
    let active = true;
    api
      .ready()
      .then(({ ok }) => {
        if (active) setStatus(ok ? 'API, MongoDB, and Redis are ready' : 'API dependencies are unavailable');
      })
      .catch(() => {
        if (active) setStatus('API unavailable. Start the project with npm run demo:up.');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="bg-background text-foreground h-dvh overflow-y-auto px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-7">
        <div className="space-y-3">
          <div className="text-primary flex items-center gap-2">
            <LedgerLogo />
            <span className="font-semibold">Ledger</span>
          </div>
          <p className="text-muted-foreground text-sm">Interactive walkthrough</p>
          <h1 className="text-3xl font-semibold tracking-tight">Follow the money. Verify every entry.</h1>
          <p className="text-muted-foreground">
            Explore a double-entry ledger through real API requests. All money is simulated. Actions change
            the demo database.
          </p>
          <Link to="/playground" className="text-primary inline-block text-sm underline underline-offset-4">
            Open the money playground{!user ? ' (sign-in required)' : ''}
          </Link>
          <p role="status" className="text-sm">
            {status}
          </p>
        </div>
        <section className="space-y-4 rounded-xl border p-5" aria-label="Demo access">
          <h2 className="font-semibold">
            {ready && user ? `Signed in as ${user.email}` : 'Sign in to start'}
          </h2>
          <p className="text-muted-foreground text-sm">
            This guide is public. To open accounts or move simulated money, enter a demo email and password on
            the sign-in page. Choose Alice for the first five scenarios; use Admin for reconciliation and
            reversal.
          </p>
          <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Demo credentials">
            {[
              { name: 'Alice', email: 'alice@example.com', role: 'User · Three funded accounts' },
              { name: 'Bob', email: 'bob@example.com', role: 'User · INR counterparty' },
              { name: 'Admin', email: 'admin@example.com', role: 'Admin · Reversal and audit' },
            ].map((person) => (
              <div key={person.email} className="bg-muted/30 space-y-2 rounded-lg border p-3">
                <h3 className="text-sm font-semibold">{person.name}</h3>
                <p className="text-muted-foreground text-xs">{person.role}</p>
                <code className="block break-all text-xs">{person.email}</code>
              </div>
            ))}
          </div>
          <p className="text-sm">
            Password for all three: <code className="bg-muted rounded px-2 py-1">Sup3rStrong!Pass</code>
          </p>
          <p className="text-muted-foreground text-xs">
            Shared simulation accounts only. Use a demo account for this walkthrough, or create your own
            account on the sign-in page.
          </p>
          {ready && user ? (
            <p className="text-sm">
              Your current session stays active while you read this guide. To use another account, return to
              the dashboard and log out first.
            </p>
          ) : (
            <Link
              to="/login"
              className="text-primary inline-block rounded-md border px-4 py-2 text-sm font-medium"
            >
              Sign in with demo credentials
            </Link>
          )}
          <p className="text-muted-foreground text-xs">
            Each scenario is manual: inspect the result before continuing. Reopening this guide does not reset
            data.
          </p>
        </section>
        <div className="grid gap-4 sm:grid-cols-2">
          {scenarios.map((scenario) => (
            <section key={scenario.title} className="space-y-3 rounded-xl border p-5">
              <h2 className="font-semibold">{scenario.title}</h2>
              <p className="text-sm">{scenario.action}</p>
              <p className="text-muted-foreground text-sm">
                <strong>What to observe: </strong>
                {scenario.proof}
              </p>
              {scenario.path === '/admin' && ready && user && !isAdmin ? (
                <p className="text-muted-foreground text-sm">
                  Admin access required.{' '}
                  <Link className="underline" to="/">
                    Return to the dashboard
                  </Link>
                  , log out, then sign in with the Admin credentials above.
                </p>
              ) : (
                <Link
                  className="text-sm underline underline-offset-4"
                  to={ready && user ? scenario.path : '/login'}
                >
                  {ready && user ? 'Open scenario' : 'Sign in to open scenario'}
                </Link>
              )}
            </section>
          ))}
        </div>
        <Link className="text-sm underline" to={user ? '/' : '/login'}>
          {user ? 'Back to dashboard' : 'Back to sign in'}
        </Link>
      </div>
    </main>
  );
}
