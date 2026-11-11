import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  CircleDot,
  RefreshCw,
  Terminal,
  Play,
  RotateCcw,
  ArrowUpRight,
  FlaskConical,
  GitBranch,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  api,
  newIdempotencyKey,
  subscribeApiTrace,
  type Account,
  type BalanceReport,
  type LedgerEntry,
  type Transaction,
} from '@/lib/api';
import { formatMinor, parseAmount } from '@/lib/money';
import { describeError } from '@/lib/useAsync';
import { IdChip, StatusBadge } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { MoneyFlow } from '@/components/MoneyFlow';
import { ErrorBoundary } from '@/components/ErrorBoundary';

type Operation = 'transfer' | 'authorize' | 'deposit' | 'withdraw';
type Payment = {
  operation: Operation;
  source: string;
  destination: string;
  amount: number;
  currency: string;
  key: string;
};
type Event = {
  id: number;
  time: number;
  level: 'info' | 'success' | 'error';
  message: string;
  detail?: string;
};
const names: Record<Operation, string> = {
  transfer: 'Transfer',
  authorize: 'Hold',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
};
const nickname = (account: Account) =>
  typeof account.metadata?.nickname === 'string' ? account.metadata.nickname : account.accountType;

export function Playground() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [reports, setReports] = useState<Record<string, BalanceReport>>({});
  const [before, setBefore] = useState<Record<string, number>>({});
  const [operation, setOperation] = useState<Operation>('transfer');
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [amount, setAmount] = useState('10.00');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventFilter, setEventFilter] = useState('all');
  const [lastRequest, setLastRequest] = useState<Payment | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [hold, setHold] = useState<Transaction | null>(null);
  const [replayed, setReplayed] = useState(false);
  const guard = useRef(false);
  const alive = useRef(false);
  const sequence = useRef(0);

  const log = useCallback((level: Event['level'], message: string, detail?: string) => {
    if (alive.current)
      setEvents((current) => [
        ...current.slice(-199),
        { id: ++sequence.current, time: Date.now(), level, message, detail },
      ]);
  }, []);

  const refresh = useCallback(async () => {
    const list = await api.accounts.list();
    if (!alive.current) return list;
    setAccounts(list);
    const results = await Promise.allSettled(
      list.filter((a) => a.status !== 'CLOSED').map((a) => api.accounts.balance(a._id))
    );
    if (!alive.current) return list;
    const balances: Record<string, BalanceReport> = {};
    for (const result of results) {
      if (result.status === 'fulfilled') balances[result.value.accountId] = result.value;
    }
    setReports(balances);
    if (results.some((result) => result.status === 'rejected'))
      log('error', 'Some reconciliation reads failed. Refresh to check the journal.');
    return list;
  }, [log]);

  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeApiTrace((event) => {
      const label = `${event.method} /api/v1${event.path}`;
      if (event.phase === 'request') log('info', `Request · ${label}`);
      else
        log(
          event.phase === 'network-error' || (event.status ?? 0) >= 400 ? 'error' : 'success',
          `${event.phase === 'network-error' ? 'Network error' : `HTTP ${event.status}`} · ${label}`,
          `${event.durationMs} ms${event.requestId ? ` · request ${event.requestId}` : ''}`
        );
    });
    void refresh()
      .catch((err) => {
        if (alive.current) setError(describeError(err));
      })
      .finally(() => {
        if (alive.current) setLoaded(true);
      });
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [log, refresh]);

  const usable = accounts.filter((a) => a.status === 'ACTIVE');
  const source =
    usable.find((a) => a._id === sourceId) ??
    usable.find((a) => usable.some((b) => b._id !== a._id && b.currency === a.currency)) ??
    usable[0];
  const destinations = usable.filter((a) => a._id !== source?._id && a.currency === source?.currency);
  const destination = destinations.find((a) => a._id === destinationId) ?? destinations[0];
  const needsDestination = operation === 'transfer' || operation === 'authorize';
  const parsed = parseAmount(amount);

  async function task(work: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      const message = describeError(err);
      if (alive.current) setError(message);
      log('error', message);
    } finally {
      guard.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function evidence(result: Transaction) {
    // A failed read after commit must never be reported as a failed payment.
    const results = await Promise.allSettled([
      refresh(),
      api.ledger.byTransaction(result._id),
      api.transactions.get(result._id),
    ]);
    if (!alive.current) return;
    if (results[2].status === 'fulfilled') {
      const current = results[2].value;
      setTransaction(current);
      if (current.status === 'PENDING') setHold(current);
      else setHold((pending) => (pending?._id === current._id ? null : pending));
    }
    if (results[1].status === 'fulfilled') {
      const legs = results[1].value;
      setEntries(legs);
      for (const leg of legs)
        log(
          'success',
          `${leg.entryType} ${formatMinor(leg.amount, leg.currency)} · ${leg.accountId}`,
          `Journal balance after: ${formatMinor(leg.balanceAfter, leg.currency)}`
        );
      if (!legs.length) log('info', 'No journal entries: a reservation or void does not move posted money.');
    }
    if (results.some((r) => r.status === 'rejected')) {
      log(
        'error',
        'Operation accepted, but evidence could not be fully refreshed. Refresh balances or open Transactions.'
      );
      setError('Operation accepted. Some evidence reads failed; refresh before drawing conclusions.');
    }
  }

  async function execute(payment: Payment, retry = false) {
    const current = await api.accounts.list();
    if (!alive.current) return;
    setBefore(Object.fromEntries(current.map((a) => [a._id, a.balance])));
    setLastRequest(payment);
    const body = { amount: payment.amount, reference: 'Ledger playground' };
    const result =
      payment.operation === 'transfer'
        ? await api.transactions.transfer(
            { ...body, fromAccount: payment.source, toAccount: payment.destination },
            payment.key
          )
        : payment.operation === 'authorize'
          ? await api.transactions.authorize(
              { ...body, fromAccount: payment.source, toAccount: payment.destination },
              payment.key
            )
          : payment.operation === 'deposit'
            ? await api.transactions.deposit({ ...body, accountId: payment.source }, payment.key)
            : await api.transactions.withdraw({ ...body, accountId: payment.source }, payment.key);
    if (!alive.current) return;
    setTransaction(result);
    setEntries(null);
    const isReplay = retry && transaction?._id === result._id;
    setReplayed(isReplay);
    if (payment.operation === 'authorize' && !retry && result.status === 'PENDING') setHold(result);
    log(
      'success',
      `${retry ? 'Retry returned' : names[payment.operation]} · ${result.status}`,
      `Transaction ${result._id} · key ${payment.key}`
    );
    if (retry)
      log(
        'info',
        'The original request key and payload were reused. Compare balances and transaction ID to verify replay.'
      );
    await evidence(result);
  }

  function run() {
    if (!source || parsed.minor === null || (needsDestination && !destination)) return;
    const payment: Payment = {
      operation,
      source: source._id,
      destination: destination?._id ?? '',
      amount: parsed.minor,
      currency: source.currency,
      key: newIdempotencyKey(),
    };
    void task(() => execute(payment));
  }

  function settle(capture: boolean) {
    if (!hold) return;
    void task(async () => {
      const current = await api.accounts.list();
      if (!alive.current) return;
      setBefore(Object.fromEntries(current.map((a) => [a._id, a.balance])));
      const result = capture
        ? await api.transactions.capture(hold._id)
        : await api.transactions.voidHold(hold._id, 'Playground release');
      if (!alive.current) return;
      setHold(null);
      setTransaction(result);
      setEntries(null);
      setReplayed(false);
      log('success', `${capture ? 'Captured' : 'Voided'} hold ${result._id} · ${result.status}`);
      await evidence(result);
    });
  }

  function setup() {
    void task(async () => {
      log('info', 'Preparing two INR demo wallets. New wallets start at zero.');
      let list = await api.accounts.list();
      const wallets: Account[] = [];
      for (const slot of ['A', 'B']) {
        let wallet = list.find(
          (a) => a.status === 'ACTIVE' && a.currency === 'INR' && a.metadata?.playgroundSlot === slot
        );
        if (!wallet) {
          // Reuse the same key after a network failure rather than creating duplicates.
          wallet = await api.accounts.create(
            { accountType: 'WALLET', currency: 'INR' },
            `playground-wallet-${slot}-v1`
          );
          wallet = await api.accounts.setMetadata(wallet._id, {
            nickname: `Playground ${slot}`,
            playgroundSlot: slot,
          });
          list = [...list, wallet];
        }
        wallets.push(wallet);
        await api.transactions.deposit(
          {
            accountId: wallet._id,
            amount: slot === 'A' ? 100_000 : 25_000,
            reference: `Playground wallet ${slot} funding`,
          },
          `playground-fund-${wallet._id}-v1`
        );
      }
      if (!alive.current) return;
      setSourceId(wallets[0]._id);
      setDestinationId(wallets[1]._id);
      log('success', 'Demo wallets ready. Funding keys are reused on repeated setup.');
      await refresh();
    });
  }

  const debitTotal = (entries ?? [])
    .filter((e) => e.entryType === 'DEBIT')
    .reduce((sum, e) => sum + e.amount, 0);
  const creditTotal = (entries ?? [])
    .filter((e) => e.entryType === 'CREDIT')
    .reduce((sum, e) => sum + e.amount, 0);
  const accountLabel = (id?: string) => {
    const account = accounts.find((a) => a._id === id);
    if (account) return nickname(account);
    if (
      (transaction?.type === 'DEPOSIT' && id === transaction.fromAccount) ||
      (transaction?.type === 'WITHDRAWAL' && id === transaction.toAccount)
    )
      return 'System contra account';
    return id ? `Account ${id.slice(-6)}` : '—';
  };

  const filteredEvents = events.filter((event) =>
    eventFilter === 'errors'
      ? event.level === 'error'
      : eventFilter === 'journal'
        ? /^(DEBIT|CREDIT|No journal)/.test(event.message)
        : true
  );
  return (
    <div className="playground-workspace flex min-h-0 flex-col gap-4 xl:h-full">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">Playground</h1>
            <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary text-[9px]">
              SANDBOX
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs">
            A live map of your money. Run an experiment and follow the evidence.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void task(async () => {
              await refresh();
              setLoaded(true);
            })
          }
        >
          <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
          Refresh balances
        </Button>
      </div>
      {error && (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!loaded ? (
        <p role="status" className="text-muted-foreground text-xs">
          Loading your accounts…
        </p>
      ) : !source || !destination ? (
        <Card className="shrink-0 py-3">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
            <div className="max-w-xl space-y-1">
              <h2 className="text-sm font-medium">Prepare a place to experiment</h2>
              <p className="text-muted-foreground text-xs">
                Create two INR wallets funded with ₹1,000 and ₹250. This uses your account allowance and
                requires demo deposits to be enabled.
              </p>
            </div>
            <Button size="sm" disabled={busy} onClick={setup}>
              <FlaskConical className="size-3.5" />
              Create two funded demo wallets
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid min-h-0 gap-4 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_290px] xl:grid-cols-[minmax(0,1fr)_310px]">
        <Card className="order-2 min-h-[430px] min-w-0 gap-0 overflow-hidden py-0 xl:order-1 xl:min-h-0">
          <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-xs font-medium">
              <GitBranch className="text-primary size-3.5" />
              Money data flow
            </CardTitle>
            <span className="text-muted-foreground flex items-center gap-2 text-[10px]">
              <span className="bg-primary size-1 rounded-full" />
              {source?.currency ?? 'INR'}
              <span className="text-white/15">/</span>Double entry
            </span>
          </CardHeader>
          <div className="min-h-0 flex-1">
            <ErrorBoundary scope="The money diagram">
              <MoneyFlow
                source={source}
                destination={destination}
                reports={reports}
                before={before}
                operation={operation}
                lastOperation={lastRequest?.operation}
                transaction={transaction}
                entries={entries}
                busy={busy}
                error={error}
                replayed={replayed}
              />
            </ErrorBoundary>
          </div>
          <div className="text-muted-foreground flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/5 px-4 py-2 text-[9px]">
            <span>Simulated money · changes save to your accounts</span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="size-3 text-primary" />
              Confirmed API state
            </span>
          </div>
        </Card>
        <Card className="order-1 min-h-0 min-w-0 gap-0 py-0 xl:order-2">
          <ScrollArea className="h-full xl:min-h-0">
            <div className="space-y-5 p-4">
              <section className="space-y-4" aria-label="Simulation controls">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold">Experiment settings</h2>
                  <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                    {busy ? 'Running' : 'Ready'}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="play-operation" className="text-[11px]">
                    Operation
                  </Label>
                  <Select
                    value={operation}
                    onValueChange={(value) => setOperation(value as Operation)}
                    disabled={busy}
                  >
                    <SelectTrigger id="play-operation" className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {Object.entries(names).map(([value, name]) => (
                        <SelectItem key={value} value={value}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="play-source" className="text-[11px]">
                    Source account
                  </Label>
                  <Select
                    value={source?._id ?? ''}
                    onValueChange={(value) => {
                      setSourceId(value);
                      setDestinationId('');
                    }}
                    disabled={busy || !source}
                  >
                    <SelectTrigger id="play-source" className="h-9 w-full min-w-0">
                      <SelectValue placeholder="No active accounts" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {usable.map((account) => (
                        <SelectItem key={account._id} value={account._id}>
                          {nickname(account)} · {account.currency} · {account.accountNumber.slice(-4)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="play-destination" className="text-[11px]">
                    Destination account
                  </Label>
                  <Select
                    value={destination?._id ?? ''}
                    onValueChange={setDestinationId}
                    disabled={busy || !needsDestination || !destination}
                  >
                    <SelectTrigger id="play-destination" className="h-9 w-full min-w-0">
                      <SelectValue placeholder="No matching account" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {destinations.map((account) => (
                        <SelectItem key={account._id} value={account._id}>
                          {nickname(account)} · {account.accountNumber.slice(-4)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="play-amount" className="text-[11px]">
                    Amount ({source?.currency ?? 'INR'})
                  </Label>
                  <Input
                    id="play-amount"
                    className="h-10 text-lg font-medium tabular-nums"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    disabled={busy}
                    onChange={(event) => setAmount(event.target.value)}
                    aria-invalid={Boolean(parsed.error)}
                    aria-describedby={parsed.error ? 'amount-error' : undefined}
                  />
                  {parsed.error && (
                    <p id="amount-error" className="text-destructive text-[10px]">
                      {parsed.error}
                    </p>
                  )}
                </div>
                <p className="text-muted-foreground text-[10px] leading-relaxed">
                  {operation === 'authorize'
                    ? 'Reserve available funds. Capture posts the money; void releases it.'
                    : operation === 'deposit'
                      ? 'Fund the selected source account against the system contra account.'
                      : operation === 'withdraw'
                        ? 'Move funds from the source to the system contra account.'
                        : 'Both accounts and the two journal legs update atomically.'}
                </p>
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    disabled={
                      busy ||
                      !source ||
                      parsed.minor === null ||
                      (needsDestination && !destination) ||
                      (operation === 'authorize' && Boolean(hold))
                    }
                    onClick={run}
                  >
                    <Play className="size-3.5 fill-current" />
                    Run {names[operation].toLowerCase()}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={busy || !lastRequest}
                    onClick={() => {
                      if (lastRequest) void task(() => execute(lastRequest, true));
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                    Retry last request
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-muted-foreground h-7 w-full text-[11px]"
                    disabled={busy || !source || !Number.isSafeInteger(source.availableBalance + 100)}
                    onClick={() => {
                      if (!source) return;
                      setOperation('withdraw');
                      setAmount(((Math.max(0, source.availableBalance) + 100) / 100).toFixed(2));
                    }}
                  >
                    <ArrowUpRight className="size-3" />
                    Try an overdraft
                  </Button>
                </div>
              </section>
              {hold && (
                <div className="border-primary/20 bg-primary/5 space-y-2 rounded-lg border p-3">
                  <p className="text-xs font-medium">
                    Pending hold · {formatMinor(hold.amount, hold.currency)}
                  </p>
                  <div className="flex gap-2">
                    <Button disabled={busy} size="sm" className="flex-1" onClick={() => settle(true)}>
                      Capture hold
                    </Button>
                    <Button
                      disabled={busy}
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => settle(false)}
                    >
                      Void hold
                    </Button>
                  </div>
                  <Link className="text-muted-foreground text-[9px] underline" to="/transactions">
                    Other holds remain in Transactions
                  </Link>
                </div>
              )}
              <section className="space-y-3 border-t border-white/5 pt-4" aria-label="Latest result">
                <h2 className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                  Latest confirmed result
                </h2>
                {transaction ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-lg tabular-nums">
                        {formatMinor(transaction.amount, transaction.currency)}
                      </strong>
                      <StatusBadge status={transaction.status} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <IdChip id={transaction._id} />
                      {replayed && (
                        <Badge variant="outline" className="text-primary text-[9px]">
                          Retry result
                        </Badge>
                      )}
                    </div>
                    {entries === null ? (
                      <p className="text-muted-foreground text-[10px]">
                        Journal evidence is loading or unavailable.
                      </p>
                    ) : entries.length ? (
                      <p
                        className="flex items-start gap-1.5 text-[10px] text-emerald-400"
                        data-testid="journal-verdict"
                      >
                        <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
                        {debitTotal === creditTotal ? 'Debits equal credits' : 'Journal mismatch'} ·{' '}
                        {formatMinor(debitTotal, transaction.currency)} each side
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-[10px]" data-testid="journal-verdict">
                        No journal entries.{' '}
                        {transaction.status === 'PENDING'
                          ? 'Funds are reserved, not posted.'
                          : 'The reservation was released without moving posted money.'}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    Run your first experiment. Its transaction and journal evidence appear here.
                  </p>
                )}
                {lastRequest && (
                  <div className="bg-muted/40 rounded-md p-2">
                    <p className="text-muted-foreground mb-1 text-[9px]">Idempotency key</p>
                    <code className="text-muted-foreground block break-all text-[9px]">
                      {lastRequest.key}
                    </code>
                  </div>
                )}
              </section>
            </div>
          </ScrollArea>
        </Card>
      </div>
      <Card className="shrink-0 gap-0 overflow-hidden py-0" aria-label="Request timeline">
        <Tabs defaultValue="activity" className="gap-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
            <TabsList variant="line" className="h-7">
              <TabsTrigger value="activity" className="gap-2 px-2 text-[11px]">
                <Terminal className="size-3" />
                Activity
                <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                  {events.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="journal" className="gap-2 px-2 text-[11px]">
                <ShieldCheck className="size-3" />
                Journal
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-1">
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger
                  aria-label="Timeline filter"
                  size="sm"
                  className="w-[105px] border-0 text-[10px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All activity</SelectItem>
                  <SelectItem value="errors">Errors only</SelectItem>
                  <SelectItem value="journal">Journal entries</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label="Clear timeline"
                onClick={() => setEvents([])}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
          <TabsContent value="activity" className="m-0">
            <ScrollArea className="playground-events h-[220px] xl:h-[155px]">
              <ol className="divide-y divide-white/[.025] p-2 font-mono text-[10px]" aria-label="API events">
                {[...filteredEvents].reverse().map((event) => (
                  <li
                    key={event.id}
                    className="grid min-w-0 grid-cols-[58px_minmax(0,1fr)] gap-3 rounded px-2 py-1.5 hover:bg-white/[.02]"
                  >
                    <span className="text-muted-foreground/60 pt-0.5 text-[9px]">
                      {new Date(event.time).toLocaleTimeString([], { hour12: false })}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={`flex items-start gap-2 break-all ${event.level === 'error' ? 'text-destructive' : 'text-foreground/80'}`}
                      >
                        {event.level === 'success' ? (
                          <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-400" />
                        ) : (
                          <CircleDot
                            className={`mt-0.5 size-3 shrink-0 ${event.level === 'error' ? 'text-destructive' : 'text-primary'}`}
                          />
                        )}
                        <span>{event.message}</span>
                      </p>
                      {event.detail && (
                        <p className="text-muted-foreground/70 mt-0.5 break-all pl-5 text-[9px]">
                          {event.detail}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
                {!events.length ? (
                  <li className="text-muted-foreground p-4">
                    Waiting for an action. Run a payment or refresh balances.
                  </li>
                ) : !filteredEvents.length ? (
                  <li className="text-muted-foreground p-4">No events match this filter.</li>
                ) : null}
              </ol>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="journal" className="m-0">
            <ScrollArea className="playground-events h-[220px] xl:h-[155px]">
              {entries?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">Entry</TableHead>
                      <TableHead className="text-[10px]">Account</TableHead>
                      <TableHead className="text-right text-[10px]">Amount</TableHead>
                      <TableHead className="text-right text-[10px]">Balance after</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry._id}>
                        <TableCell className="text-[10px]">
                          <Badge variant="outline" className="text-[9px]">
                            {entry.entryType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[10px]">{accountLabel(entry.accountId)}</TableCell>
                        <TableCell className="tabular text-right text-[10px]">
                          {formatMinor(entry.amount, entry.currency)}
                        </TableCell>
                        <TableCell className="tabular text-right text-[10px]">
                          {formatMinor(entry.balanceAfter, entry.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground p-5 text-xs">
                  {transaction?.status === 'PENDING'
                    ? 'A hold reserves funds without posting journal entries.'
                    : 'Run a posted payment to inspect its journal pair.'}
                </p>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
        <div className="text-muted-foreground/60 flex flex-wrap justify-between gap-1 border-t border-white/5 px-4 py-1.5 text-[9px]">
          <span>Actual API events · latest 200 · credentials excluded</span>
          <span>Clear removes local events only</span>
        </div>
        <div role="status" className="sr-only">
          {busy ? 'Request in progress' : error ? 'Action needs attention' : 'Ready'}
        </div>
      </Card>
    </div>
  );
}
