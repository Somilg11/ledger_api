import { useState } from 'react';
import { RotateCcw, ShieldAlert, ShieldCheck, Snowflake } from 'lucide-react';
import { api } from '@/lib/api';
import { describeError, useAsync } from '@/lib/useAsync';
import { formatMinor } from '@/lib/money';
import { Field, IdChip, InlineError, Money, PageHeader, StatusBadge, SubmitButton } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import type { Transaction } from '@/lib/api';

export function Admin() {
  return (
    <div>
      <PageHeader
        title="Admin"
        description="Privileged operations. Every route here is rejected with 403 for a normal user."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <VerifyCard />
        <ReverseCard />
        <UnfreezeCard />
      </div>
    </div>
  );
}

function VerifyCard() {
  const { data, error, loading, reload } = useAsync(() => api.ledger.verify(), []);

  return (
    <Card className="surface-edge gap-0 py-0 lg:col-span-2">
      <CardHeader className="border-border border-b px-4 py-3">
        <CardTitle className="text-[13px] font-medium">Double-entry verification</CardTitle>
        <CardDescription className="text-[12px]">
          Sums every journal entry in the database. Debits must equal credits.
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            Re-run
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="p-4">
        {loading ? (
          <Skeleton className="h-14" />
        ) : error ? (
          <InlineError message={error} />
        ) : (
          <div className="flex flex-wrap items-center gap-6">
            <div
              className={
                data!.balanced
                  ? 'flex items-center gap-2 rounded-md border border-[var(--credit)]/25 bg-[var(--credit)]/10 px-3 py-2'
                  : 'border-destructive/25 bg-destructive/10 flex items-center gap-2 rounded-md border px-3 py-2'
              }
            >
              {data!.balanced ? (
                <ShieldCheck className="size-4 text-[var(--credit)]" />
              ) : (
                <ShieldAlert className="text-destructive size-4" />
              )}
              <span
                className={
                  data!.balanced ? 'text-[13px] font-medium text-[var(--credit)]' : 'text-destructive text-[13px] font-medium'
                }
              >
                {data!.balanced ? 'Books balance' : 'Books do not balance'}
              </span>
            </div>

            <div className="flex gap-8">
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-[11px]">Total debits</p>
                <p className="tabular text-[13px] font-medium">{formatMinor(data!.totalDebits)}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground text-[11px]">Total credits</p>
                <p className="tabular text-[13px] font-medium">{formatMinor(data!.totalCredits)}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReverseCard() {
  const [id, setId] = useState('');
  const [reason, setReason] = useState('');
  const [found, setFound] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function lookup() {
    setError(null);
    setFound(null);
    if (!id.trim()) return;
    setPending(true);
    try {
      setFound(await api.transactions.get(id.trim()));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  async function reverse() {
    setPending(true);
    setError(null);
    try {
      const reversal = await api.transactions.reverse(found!._id, reason.trim() || undefined);
      toast.success(`Reversed — new transaction …${reversal._id.slice(-6)}`);
      setFound(await api.transactions.get(found!._id));
      setReason('');
    } catch (err) {
      const message = describeError(err);
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="surface-edge gap-0 py-0">
      <CardHeader className="border-border border-b px-4 py-3">
        <CardTitle className="text-[13px] font-medium">Reverse a transaction</CardTitle>
        <CardDescription className="text-[12px]">
          Writes an opposite transaction and marks the original REVERSED. Nothing is edited or deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="txnId">Transaction id</Label>
          <div className="flex gap-2">
            <Input
              id="txnId"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="65f1a2…"
              className="font-mono text-[12px]"
            />
            <Button variant="outline" size="sm" onClick={() => void lookup()} disabled={pending}>
              Look up
            </Button>
          </div>
        </div>

        <InlineError message={error} />

        {found && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Money minor={found.amount} currency={found.currency} className="text-[16px]" />
                <StatusBadge status={found.status} />
              </div>
              <div className="divide-border divide-y">
                <Field label="Type">{found.type}</Field>
                <Field label="Reference">{found.reference || '—'}</Field>
                <Field label="From">
                  <IdChip id={found.fromAccount} />
                </Field>
                <Field label="To">
                  <IdChip id={found.toAccount} />
                </Field>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason</Label>
                <Input
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Disputed by customer"
                  maxLength={280}
                />
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    disabled={pending || found.status !== 'COMPLETED'}
                  >
                    <RotateCcw className="size-3.5" />
                    {found.status === 'COMPLETED' ? 'Reverse transaction' : `Cannot reverse a ${found.status} transaction`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reverse this transaction?</AlertDialogTitle>
                    <AlertDialogDescription className="text-[12px]">
                      {formatMinor(found.amount, found.currency)} moves back to the originating account and the
                      original is marked REVERSED. A transaction can only be reversed once.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void reverse()}>Reverse</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UnfreezeCard() {
  const [id, setId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function unfreeze() {
    setPending(true);
    setError(null);
    try {
      const account = await api.accounts.unfreeze(id.trim());
      toast.success(`${account.accountNumber} is now ${account.status}`);
      setId('');
    } catch (err) {
      const message = describeError(err);
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="surface-edge gap-0 py-0">
      <CardHeader className="border-border border-b px-4 py-3">
        <CardTitle className="text-[13px] font-medium">Unfreeze an account</CardTitle>
        <CardDescription className="text-[12px]">
          A user can freeze their own account but only the bank can unfreeze it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="accountId">Account id</Label>
          <Input
            id="accountId"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="65f1a2…"
            className="font-mono text-[12px]"
          />
        </div>

        <InlineError message={error} />

        <SubmitButton pending={pending} onClick={() => void unfreeze()} disabled={!id.trim()} className="w-full">
          <Snowflake className="size-3.5" />
          Unfreeze
        </SubmitButton>
      </CardContent>
    </Card>
  );
}
