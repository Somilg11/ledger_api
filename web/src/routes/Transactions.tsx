import { useState } from 'react';
import { Ban, CheckCheck, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Account, type LedgerEntry, type Transaction } from '@/lib/api';
import { describeError, useAsync } from '@/lib/useAsync';
import { absoluteTime, relativeTime } from '@/lib/format';
import { EmptyState, Field, IdChip, Money, PageHeader, StatusBadge } from '@/components/primitives';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

export function Transactions() {
  const { data: accounts, loading: loadingAccounts } = useAsync(() => api.accounts.list(), []);
  const [chosenId, setChosenId] = useState('');
  // Derived rather than synced: an effect that copies props into state runs a
  // render late and can flash the wrong selection.
  const accountId = chosenId || accounts?.[0]?._id || '';
  const [selected, setSelected] = useState<Transaction | null>(null);

  const {
    data: txns,
    error,
    loading,
    reload,
  } = useAsync(async () => (accountId ? api.transactions.listByAccount(accountId, 100) : []), [accountId]);

  const account = accounts?.find((a) => a._id === accountId);

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="Statement for one account. Reading an account you do not own returns a 404, not a 403."
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

      <Card className="surface-edge gap-0 overflow-hidden py-0">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : (txns?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No transactions"
              description="Deposits, transfers and withdrawals for this account will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px]">When</TableHead>
                  <TableHead className="text-[11px]">Type</TableHead>
                  <TableHead className="text-[11px]">Reference</TableHead>
                  <TableHead className="text-[11px]">Status</TableHead>
                  <TableHead className="text-right text-[11px]">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns!.map((txn) => {
                  const outgoing = txn.fromAccount === accountId;
                  return (
                    <TableRow
                      key={txn._id}
                      onClick={() => setSelected(txn)}
                      className="cursor-pointer"
                      title="Open details"
                    >
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {relativeTime(txn.createdAt)}
                      </TableCell>
                      <TableCell>{txn.type}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[240px] truncate">
                        {txn.reference || '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={txn.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money
                          minor={outgoing ? -txn.amount : txn.amount}
                          currency={txn.currency}
                          tone="auto"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {account && (txns?.length ?? 0) > 0 && (
        <p className="text-muted-foreground mt-3 text-[11px]">
          Showing {txns!.length} most recent for {account.accountNumber}.
        </p>
      )}

      <TransactionSheet
        transaction={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        accounts={accounts ?? []}
        onSettled={async (updated) => {
          setSelected(updated);
          await reload();
        }}
      />
    </div>
  );
}

function TransactionSheet({
  transaction,
  onOpenChange,
  accounts,
  onSettled,
}: {
  transaction: Transaction | null;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  onSettled: (updated: Transaction) => Promise<void>;
}) {
  const [settling, setSettling] = useState(false);

  async function settle(kind: 'capture' | 'void') {
    if (!transaction) return;
    setSettling(true);
    try {
      const updated =
        kind === 'capture'
          ? await api.transactions.capture(transaction._id)
          : await api.transactions.voidHold(transaction._id, 'Released from the console');

      toast.success(kind === 'capture' ? 'Hold captured — the money has moved' : 'Hold released');
      await onSettled(updated);
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setSettling(false);
    }
  }

  const { data: legs, loading } = useAsync<LedgerEntry[]>(
    async () => (transaction ? api.ledger.byTransaction(transaction._id) : []),
    [transaction?._id]
  );

  function nameFor(id?: string) {
    const account = accounts.find((a) => a._id === id);
    if (!account) return id ? `…${id.slice(-6)}` : '—';
    return `${(account.metadata?.nickname as string) || account.accountType} · ${account.accountNumber}`;
  }

  return (
    <Sheet open={Boolean(transaction)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-[420px]">
        <SheetHeader className="border-border border-b">
          <SheetTitle className="text-[14px]">Transaction</SheetTitle>
          <SheetDescription className="text-[12px]">
            The record and the journal entries it produced.
          </SheetDescription>
        </SheetHeader>

        {transaction && (
          <div className="space-y-5 overflow-y-auto p-4">
            <div className="flex items-center justify-between">
              <Money minor={transaction.amount} currency={transaction.currency} className="text-[20px]" />
              <StatusBadge status={transaction.status} />
            </div>

            <div className="divide-border divide-y">
              <Field label="Type">{transaction.type}</Field>
              <Field label="From">{nameFor(transaction.fromAccount)}</Field>
              <Field label="To">{nameFor(transaction.toAccount)}</Field>
              <Field label="Reference">{transaction.reference || '—'}</Field>
              <Field label="Created">{absoluteTime(transaction.createdAt)}</Field>
              <Field label="Completed">{absoluteTime(transaction.completedAt)}</Field>
              <Field label="Transaction id">
                <IdChip id={transaction._id} />
              </Field>
            </div>

            {transaction.status === 'PENDING' && (
              <div className="border-border space-y-3 rounded-lg border border-dashed p-3">
                <p className="text-muted-foreground text-[12px] leading-relaxed">
                  This is a hold. The funds are reserved but have not moved, so there are no ledger entries
                  yet. Capture settles it; voiding releases the reservation.
                  {transaction.expiresAt && ` Expires ${absoluteTime(transaction.expiresAt)}.`}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void settle('capture')} disabled={settling}>
                    <CheckCheck className="size-3.5" />
                    Capture
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void settle('void')} disabled={settling}>
                    <Ban className="size-3.5" />
                    Void
                  </Button>
                </div>
              </div>
            )}

            {transaction.metadata?.reversalOf ? (
              <Alert>
                <AlertDescription className="text-[12px]">
                  Reversal of <IdChip id={String(transaction.metadata.reversalOf)} />
                  {transaction.metadata.reason ? ` — ${String(transaction.metadata.reason)}` : ''}
                </AlertDescription>
              </Alert>
            ) : null}

            <Separator />

            <div>
              <p className="text-muted-foreground mb-2 text-[11px] tracking-wide uppercase">Ledger entries</p>
              {loading ? (
                <Skeleton className="h-16" />
              ) : (legs ?? []).length === 0 ? (
                <p className="text-muted-foreground text-[12px]">
                  None — nothing has moved in accounting terms.
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {(legs ?? []).map((leg) => (
                    <li key={leg._id} className="space-y-1 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge status={leg.entryType} />
                        <Money
                          minor={leg.entryType === 'DEBIT' ? -leg.amount : leg.amount}
                          currency={leg.currency}
                          tone="auto"
                        />
                      </div>
                      <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                        <span className="truncate">{nameFor(leg.accountId)}</span>
                        <span className="tabular">balance after {(leg.balanceAfter / 100).toFixed(2)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
