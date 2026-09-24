import { useState } from 'react';
import { BookOpenText, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { formatMinor } from '@/lib/money';
import { absoluteTime } from '@/lib/format';
import { EmptyState, IdChip, Money, PageHeader, StatusBadge } from '@/components/primitives';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function Ledger() {
  const { data: accounts, loading: loadingAccounts } = useAsync(() => api.accounts.list(), []);
  const [chosenId, setChosenId] = useState('');
  // Derived rather than synced: an effect that copies props into state runs a
  // render late and can flash the wrong selection.
  const accountId = chosenId || accounts?.[0]?._id || '';

  const { data, error, loading } = useAsync(async () => {
    if (!accountId) return null;
    const [entries, report] = await Promise.all([
      api.ledger.byAccount(accountId, 100),
      api.ledger.reconcile(accountId),
    ]);
    return { entries, report };
  }, [accountId]);

  return (
    <div>
      <PageHeader
        title="Ledger"
        description="The append-only journal. Entries are never edited or deleted — corrections are reversing entries."
        actions={
          <Select value={accountId} onValueChange={setChosenId} disabled={loadingAccounts}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Choose an account" />
            </SelectTrigger>
            <SelectContent>
              {(accounts ?? []).map((a) => (
                <SelectItem key={a._id} value={a._id}>
                  <span className="font-mono text-[11px]">{a.accountNumber}</span>
                  <span className="text-muted-foreground">
                    {(a.metadata?.nickname as string) || a.accountType}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription className="text-[12px]">{error}</AlertDescription>
        </Alert>
      )}

      {data?.report && (
        <Card className="surface-edge mb-5 gap-0 py-0">
          <CardContent className="grid gap-4 p-4 sm:grid-cols-4">
            <Stat label="Cached balance" value={formatMinor(data.report.balance, data.report.currency)} />
            <Stat
              label="Ledger balance"
              value={formatMinor(data.report.ledgerBalance, data.report.currency)}
            />
            <Stat
              label="Debits / credits"
              value={`${formatMinor(data.report.totalDebits, data.report.currency)} / ${formatMinor(
                data.report.totalCredits,
                data.report.currency
              )}`}
            />
            <div className="space-y-1">
              <p className="text-muted-foreground text-[11px]">Reconciliation</p>
              <div className="flex items-center gap-1.5">
                {data.report.reconciled ? (
                  <>
                    <ShieldCheck className="size-3.5 text-[var(--credit)]" />
                    <span className="text-[13px] font-medium text-[var(--credit)]">Matches</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="text-destructive size-3.5" />
                    <span className="text-destructive text-[13px] font-medium">Drifted</span>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="surface-edge gap-0 overflow-hidden py-0">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : (data?.entries.length ?? 0) === 0 ? (
            <EmptyState
              icon={BookOpenText}
              title="No journal entries"
              description="Each movement writes one debit and one credit here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px]">When</TableHead>
                  <TableHead className="text-[11px]">Entry</TableHead>
                  <TableHead className="text-[11px]">Transaction</TableHead>
                  <TableHead className="text-right text-[11px]">Amount</TableHead>
                  <TableHead className="text-right text-[11px]">Balance after</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.entries.map((entry) => (
                  <TableRow key={entry._id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {absoluteTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={entry.entryType} />
                    </TableCell>
                    <TableCell>
                      <IdChip id={entry.transactionId} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money
                        minor={entry.entryType === 'DEBIT' ? -entry.amount : entry.amount}
                        currency={entry.currency}
                        tone="auto"
                      />
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatMinor(entry.balanceAfter, entry.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p className="tabular text-[13px] font-medium">{value}</p>
    </div>
  );
}
