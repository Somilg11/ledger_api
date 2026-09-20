import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ShieldAlert, ShieldCheck, Wallet } from 'lucide-react';
import { api, type Account, type BalanceReport, type Transaction } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { formatMinor } from '@/lib/money';
import { relativeTime } from '@/lib/format';
import { EmptyState, IdChip, Money, PageHeader, StatusBadge } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Overview {
  accounts: Account[];
  balances: BalanceReport[];
  recent: Transaction[];
}

export function Dashboard() {
  const { data, error, loading } = useAsync<Overview>(async () => {
    const accounts = await api.accounts.list();
    const live = accounts.filter((a) => a.status !== 'CLOSED');

    const balances = await Promise.all(live.map((a) => api.accounts.balance(a._id)));
    const perAccount = await Promise.all(live.slice(0, 4).map((a) => api.transactions.listByAccount(a._id, 10)));

    // One merged, de-duplicated activity feed across the user's accounts.
    const seen = new Set<string>();
    const recent = perAccount
      .flat()
      .filter((t) => (seen.has(t._id) ? false : (seen.add(t._id), true)))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);

    return { accounts, balances, recent };
  }, []);

  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const b of data?.balances ?? []) {
      byCurrency.set(b.currency, (byCurrency.get(b.currency) ?? 0) + b.balance);
    }
    return [...byCurrency.entries()];
  }, [data]);

  const drifted = (data?.balances ?? []).filter((b) => !b.reconciled);
  const ownedIds = new Set((data?.accounts ?? []).map((a) => a._id));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Balances, reconciliation status and recent movement across your accounts."
        actions={
          <Button asChild size="sm">
            <Link to="/transfer">Move money</Link>
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription className="text-[12px]">{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[92px] rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="surface-edge gap-0 py-4">
              <CardHeader className="px-4 pb-2">
                <CardTitle className="text-muted-foreground text-[12px] font-normal">Total balance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-0.5 px-4">
                {totals.length === 0 ? (
                  <p className="tabular text-[20px] font-semibold">{formatMinor(0)}</p>
                ) : (
                  totals.map(([currency, minor]) => (
                    <p key={currency} className="tabular text-[20px] font-semibold tracking-tight">
                      {formatMinor(minor, currency)}
                    </p>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="surface-edge gap-0 py-4">
              <CardHeader className="px-4 pb-2">
                <CardTitle className="text-muted-foreground text-[12px] font-normal">Open accounts</CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="tabular text-[20px] font-semibold tracking-tight">
                  {data?.accounts.filter((a) => a.status === 'ACTIVE').length ?? 0}
                </p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  {data?.accounts.filter((a) => a.status === 'FROZEN').length ?? 0} frozen ·{' '}
                  {data?.accounts.filter((a) => a.status === 'CLOSED').length ?? 0} closed
                </p>
              </CardContent>
            </Card>

            <Card className="surface-edge gap-0 py-4">
              <CardHeader className="px-4 pb-2">
                <CardTitle className="text-muted-foreground text-[12px] font-normal">Reconciliation</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2 px-4">
                {drifted.length === 0 ? (
                  <>
                    <ShieldCheck className="size-4 text-[var(--credit)]" />
                    <span className="text-[13px] font-medium">Balances match the ledger</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="text-destructive size-4" />
                    <span className="text-destructive text-[13px] font-medium">
                      {drifted.length} account{drifted.length > 1 ? 's' : ''} drifted
                    </span>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_1fr]">
            <Card className="surface-edge gap-0 py-0">
              <CardHeader className="border-border items-center border-b px-4 py-3">
                <CardTitle className="text-[13px] font-medium">Accounts</CardTitle>
                <CardAction>
                  <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-[12px]">
                    <Link to="/accounts">View all</Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="p-0">
                {(data?.accounts.length ?? 0) === 0 ? (
                  <EmptyState
                    icon={Wallet}
                    title="No accounts yet"
                    description="Open one to start moving money through the ledger."
                    action={
                      <Button asChild size="sm">
                        <Link to="/accounts">Open an account</Link>
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-border divide-y">
                    {data!.accounts.slice(0, 6).map((account) => {
                      const report = data!.balances.find((b) => b.accountId === account._id);
                      return (
                        <li key={account._id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-medium">
                                {(account.metadata?.nickname as string) || account.accountType}
                              </span>
                              <StatusBadge status={account.status} />
                            </div>
                            <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
                              {account.accountNumber} · {account.currency}
                            </p>
                          </div>
                          <Money minor={report?.balance ?? account.balance} currency={account.currency} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="surface-edge gap-0 py-0">
              <CardHeader className="border-border items-center border-b px-4 py-3">
                <CardTitle className="text-[13px] font-medium">Recent activity</CardTitle>
                <CardAction>
                  <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-[12px]">
                    <Link to="/transactions">View all</Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="p-0">
                {(data?.recent.length ?? 0) === 0 ? (
                  <EmptyState
                    icon={ArrowUpRight}
                    title="Nothing has moved yet"
                    description="Deposits, transfers and withdrawals appear here."
                  />
                ) : (
                  <ul className="divide-border divide-y">
                    {data!.recent.map((txn) => {
                      const outgoing = Boolean(txn.fromAccount && ownedIds.has(txn.fromAccount));
                      return (
                        <li key={txn._id} className="flex items-center gap-3 px-4 py-2.5">
                          <div
                            className={
                              outgoing
                                ? 'flex size-6 shrink-0 items-center justify-center rounded bg-[var(--debit)]/10'
                                : 'flex size-6 shrink-0 items-center justify-center rounded bg-[var(--credit)]/10'
                            }
                          >
                            {outgoing ? (
                              <ArrowUpRight className="size-3 text-[var(--debit)]" />
                            ) : (
                              <ArrowDownLeft className="size-3 text-[var(--credit)]" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px]">{txn.reference || txn.type}</p>
                            <p className="text-muted-foreground text-[11px]">
                              {relativeTime(txn.createdAt)} · <IdChip id={txn._id} />
                            </p>
                          </div>
                          <Money
                            minor={outgoing ? -txn.amount : txn.amount}
                            currency={txn.currency}
                            tone="auto"
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
