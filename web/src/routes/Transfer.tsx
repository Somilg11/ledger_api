import { useMemo, useState } from 'react';
import { ArrowRight, KeyRound, RefreshCw } from 'lucide-react';
import { ApiError, api, newIdempotencyKey, type Account, type Transaction } from '@/lib/api';
import { describeError, useAsync } from '@/lib/useAsync';
import { formatMinor, parseAmount, symbolFor } from '@/lib/money';
import { absoluteTime } from '@/lib/format';
import {
  Field,
  IdChip,
  InlineError,
  Money,
  PageHeader,
  StatusBadge,
  SubmitButton,
} from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

type Mode = 'transfer' | 'deposit' | 'withdraw' | 'authorize';

export function Transfer() {
  const { data: accounts, error, loading, reload } = useAsync(() => api.accounts.list(), []);
  const usable = useMemo(() => (accounts ?? []).filter((a) => a.status === 'ACTIVE'), [accounts]);

  const [mode, setMode] = useState<Mode>('transfer');
  const [result, setResult] = useState<Transaction | null>(null);
  const [replayed, setReplayed] = useState(false);

  // Getting the same transaction id back means the request was replayed rather
  // than executed again - worth saying out loud, since that is the whole point
  // of the idempotency key.
  function handleDone(txn: Transaction) {
    setReplayed(result?._id === txn._id);
    setResult(txn);
    void reload();
  }

  return (
    <div>
      <PageHeader
        title="Move money"
        description="Every movement writes a balanced pair of ledger entries inside one database transaction."
      />

      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription className="text-[12px]">{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="surface-edge gap-0 py-0">
          <CardContent className="p-4">
            {/* Only the first load swaps in skeletons. Re-rendering the form on
                every refresh would unmount it and reset the idempotency key,
                which is exactly what the replay demo needs to keep. */}
            {loading && !accounts ? (
              <div className="space-y-3">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
            ) : (
              <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="transfer">Transfer</TabsTrigger>
                  <TabsTrigger value="deposit">Deposit</TabsTrigger>
                  <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
                  <TabsTrigger value="authorize">Hold</TabsTrigger>
                </TabsList>

                <div className="pt-5">
                  <TabsContent value="transfer" className="m-0">
                    <MoneyForm mode="transfer" accounts={usable} onDone={handleDone} />
                  </TabsContent>
                  <TabsContent value="deposit" className="m-0">
                    <MoneyForm mode="deposit" accounts={usable} onDone={handleDone} />
                  </TabsContent>
                  <TabsContent value="withdraw" className="m-0">
                    <MoneyForm mode="withdraw" accounts={usable} onDone={handleDone} />
                  </TabsContent>
                  <TabsContent value="authorize" className="m-0">
                    <MoneyForm mode="authorize" accounts={usable} onDone={handleDone} />
                  </TabsContent>
                </div>
              </Tabs>
            )}
          </CardContent>
        </Card>

        <ResultPanel transaction={result} replayed={replayed} />
      </div>
    </div>
  );
}

function MoneyForm({
  mode,
  accounts,
  onDone,
}: {
  mode: Mode;
  accounts: Account[];
  onDone: (txn: Transaction) => void;
}) {
  // A hold moves between two accounts just like a transfer does; it simply
  // does not settle yet.
  const needsDestination = mode === 'transfer' || mode === 'authorize';

  const [chosenFrom, setChosenFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [key, setKey] = useState(() => newIdempotencyKey());
  const [useKey, setUseKey] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyConflict, setKeyConflict] = useState(false);
  const [pending, setPending] = useState(false);

  // Derived during render rather than synced in an effect. For a transfer the
  // default is an account that actually has a same-currency counterpart, so the
  // form does not open on a dead end with no valid destination.
  const defaultFrom = needsDestination
    ? (accounts.find((candidate) =>
        accounts.some((other) => other._id !== candidate._id && other.currency === candidate.currency)
      ) ?? accounts[0])
    : accounts[0];

  const from = chosenFrom || defaultFrom?._id || '';

  const source = accounts.find((a) => a._id === from);
  const currency = source?.currency ?? 'INR';
  const parsed = parseAmount(amount);

  // The API refuses cross-currency transfers, so only same-currency
  // destinations are offered rather than letting the user hit a 400.
  const destinations = accounts.filter((a) => a._id !== from && a.currency === currency);

  async function submit() {
    setError(null);

    const { minor, error: amountError } = parseAmount(amount);
    if (amountError || minor === null) {
      setError(amountError);
      return;
    }
    if (!from) {
      setError('Choose an account');
      return;
    }
    if (needsDestination && !to) {
      setError('Choose a destination account');
      return;
    }

    setPending(true);
    try {
      const idempotencyKey = useKey ? key : undefined;
      const body = { amount: minor, reference: reference.trim() || undefined };

      const txn =
        mode === 'transfer'
          ? await api.transactions.transfer({ fromAccount: from, toAccount: to, ...body }, idempotencyKey)
          : mode === 'authorize'
            ? await api.transactions.authorize({ fromAccount: from, toAccount: to, ...body }, idempotencyKey)
            : mode === 'deposit'
              ? await api.transactions.deposit({ accountId: from, ...body }, idempotencyKey)
              : await api.transactions.withdraw({ accountId: from, ...body }, idempotencyKey);

      toast.success(
        mode === 'authorize'
          ? `${formatMinor(minor, currency)} reserved — capture or void it from Transactions`
          : `${mode[0].toUpperCase()}${mode.slice(1)} of ${formatMinor(minor, currency)} completed`
      );
      setKeyConflict(false);
      // The amount deliberately stays put: submitting again unchanged is how
      // you see the idempotent replay.
      onDone(txn);
    } catch (err) {
      const message = describeError(err);
      setError(message);
      // A key bound to a different payload is a client-side mistake the user
      // can only fix by rotating the key, so offer that inline.
      setKeyConflict(err instanceof ApiError && err.status === 409);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{needsDestination ? 'From account' : 'Account'}</Label>
        <Select value={from} onValueChange={(v) => (setChosenFrom(v), setTo(''))}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a._id} value={a._id}>
                <span className="font-mono text-[11px]">{a.accountNumber}</span>
                <span className="text-muted-foreground">
                  {(a.metadata?.nickname as string) || a.accountType} ·{' '}
                  {formatMinor(a.availableBalance, a.currency)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {source && (
          <p className="text-muted-foreground text-[11px]">
            Available {formatMinor(source.availableBalance, source.currency)}
          </p>
        )}
      </div>

      {needsDestination && (
        <div className="space-y-1.5">
          <Label>To account</Label>
          <Select value={to} onValueChange={setTo} disabled={destinations.length === 0}>
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={
                  destinations.length === 0 ? `No other ${currency} account` : 'Choose a destination'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((a) => (
                <SelectItem key={a._id} value={a._id}>
                  <span className="font-mono text-[11px]">{a.accountNumber}</span>
                  <span className="text-muted-foreground">
                    {(a.metadata?.nickname as string) || a.accountType}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-[11px]">
            Only {currency} accounts are listed — the API rejects cross-currency transfers.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="amount">Amount</Label>
        <div className="relative">
          <span className="text-muted-foreground absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px]">
            {symbolFor(currency)}
          </span>
          <Input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500.00"
            className="tabular pl-7"
          />
        </div>
        <p className="text-muted-foreground text-[11px]">
          {parsed.minor !== null
            ? `Sent as ${parsed.minor.toLocaleString()} minor units`
            : 'Up to two decimal places; converted to integer minor units'}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reference">Reference</Label>
        <Input
          id="reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Dinner"
          maxLength={140}
        />
      </div>

      {mode === 'authorize' && (
        <p className="text-muted-foreground border-border rounded-md border border-dashed px-3 py-2 text-[11px] leading-relaxed">
          A hold reserves the funds without moving them: available balance drops, the ledger balance does not,
          and no journal entries are written. Capture it to settle, or void it to release.
        </p>
      )}

      <Separator />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5">
            <KeyRound className="size-3.5 opacity-70" />
            Idempotency key
          </Label>
          <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              checked={useKey}
              onChange={(e) => setUseKey(e.target.checked)}
              className="accent-primary size-3"
            />
            send key
          </label>
        </div>
        <div className="flex gap-2">
          <Input value={key} readOnly disabled={!useKey} className="font-mono text-[11px]" />
          <Button
            variant="outline"
            size="icon"
            disabled={!useKey}
            onClick={() => setKey(newIdempotencyKey())}
            title="Generate a new key"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        <p className="text-muted-foreground text-[11px]">
          Submit the same form twice without regenerating to watch the replay: the same transaction comes back
          and the money moves once. Changing the amount while keeping the key is a 409 by design.
        </p>
      </div>

      <div className="space-y-2">
        <InlineError message={error} />
        {keyConflict && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setKey(newIdempotencyKey());
              setKeyConflict(false);
              setError(null);
            }}
          >
            <RefreshCw className="size-3.5" />
            Use a new idempotency key
          </Button>
        )}
      </div>

      <SubmitButton pending={pending} onClick={() => void submit()} className="w-full">
        {mode === 'transfer'
          ? 'Send transfer'
          : mode === 'authorize'
            ? 'Place hold'
            : mode === 'deposit'
              ? 'Deposit'
              : 'Withdraw'}
        <ArrowRight className="size-3.5" />
      </SubmitButton>
    </div>
  );
}

function ResultPanel({ transaction, replayed }: { transaction: Transaction | null; replayed: boolean }) {
  const { data: legs } = useAsync(
    async () => (transaction ? api.ledger.byTransaction(transaction._id) : []),
    [transaction?._id]
  );

  return (
    <Card className="surface-edge h-fit gap-0 py-0">
      <CardHeader className="border-border border-b px-4 py-3">
        <CardTitle className="text-[13px] font-medium">Last result</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {!transaction ? (
          <p className="text-muted-foreground text-[12px]">
            Submit a movement to see the transaction record and both ledger legs it produced.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Money minor={transaction.amount} currency={transaction.currency} className="text-[18px]" />
              <StatusBadge status={transaction.status} />
            </div>

            {replayed && (
              <Alert>
                <AlertDescription className="text-[12px]">
                  Replayed — the idempotency key matched an earlier request, so the same transaction came back
                  and the money moved only once.
                </AlertDescription>
              </Alert>
            )}

            <div className="divide-border divide-y">
              <Field label="Type">{transaction.type}</Field>
              <Field label="Transaction">
                <IdChip id={transaction._id} />
              </Field>
              <Field label="Reference">{transaction.reference || '—'}</Field>
              <Field label="Completed">
                {absoluteTime(transaction.completedAt ?? transaction.createdAt)}
              </Field>
            </div>

            <div>
              <p className="text-muted-foreground mb-2 text-[11px] tracking-wide uppercase">Ledger entries</p>
              <ul className="divide-border divide-y">
                {(legs ?? []).map((leg) => (
                  <li key={leg._id} className="flex items-center justify-between gap-2 py-1.5">
                    <StatusBadge status={leg.entryType} />
                    <IdChip id={leg.accountId} />
                    <Money
                      minor={leg.entryType === 'DEBIT' ? -leg.amount : leg.amount}
                      currency={leg.currency}
                      tone="auto"
                    />
                  </li>
                ))}
              </ul>
              {(legs?.length ?? 0) === 2 && (
                <p className="mt-2 text-[11px] text-[var(--credit)]">Debits equal credits.</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
