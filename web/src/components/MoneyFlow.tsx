import { useId } from 'react';
import {
  Wallet,
  Landmark,
  Layers3,
  ShieldCheck,
  LoaderCircle,
  CheckCircle2,
  Clock3,
  CircleX,
} from 'lucide-react';
import type { Account, BalanceReport, LedgerEntry, Transaction } from '@/lib/api';
import { formatMinor } from '@/lib/money';
import { Badge } from '@/components/ui/badge';

interface Props {
  source?: Account;
  destination?: Account;
  reports: Record<string, BalanceReport>;
  before: Record<string, number>;
  operation: 'transfer' | 'authorize' | 'deposit' | 'withdraw';
  lastOperation?: string;
  transaction: Transaction | null;
  entries: LedgerEntry[] | null;
  busy: boolean;
  error: string | null;
  replayed: boolean;
}
const nickname = (account: Account) =>
  typeof account.metadata?.nickname === 'string' ? account.metadata.nickname : account.accountType;

function AccountBlock({
  account,
  system,
  index,
  report,
  before,
  currency,
}: {
  account?: Account;
  system: boolean;
  index: number;
  report?: BalanceReport;
  before?: number;
  currency: string;
}) {
  const delta = account && before !== undefined ? account.balance - before : null;
  return (
    <div
      className="flow-block flow-account"
      data-testid={system ? 'play-system-node' : account ? `play-account-${index}` : undefined}
    >
      <div className="flex items-center gap-2.5 border-b border-white/5 px-3 py-3">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${system ? 'bg-slate-500/10 text-slate-400' : index === 0 ? 'bg-violet-500/10 text-violet-400' : 'bg-emerald-500/10 text-emerald-400'}`}
        >
          {system ? <Landmark className="size-3.5" /> : <Wallet className="size-3.5" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">
            {system ? 'System account' : account ? nickname(account) : 'Select an account'}
          </p>
          <p className="text-muted-foreground text-[9px]">
            {system
              ? 'Funding counterparty'
              : account
                ? `${account.accountType} · ${account.accountNumber.slice(-4)}`
                : 'Simulation account'}
          </p>
        </div>
        <span className="text-muted-foreground ml-auto text-[9px]">{currency}</span>
      </div>
      <div className="space-y-2 px-3 py-3">
        {system ? (
          <>
            <p className="text-base font-semibold">Contra account</p>
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              The opposite side of simulated deposits and withdrawals.
            </p>
          </>
        ) : (
          <>
            <p className="tabular text-[23px] font-semibold tracking-tight" data-testid="posted-balance">
              {account ? formatMinor(account.balance, account.currency) : '—'}
            </p>
            <div className="text-muted-foreground flex flex-wrap justify-between gap-1 text-[10px]">
              <span>Available</span>
              <span className="tabular text-foreground/80" data-testid="available-balance">
                {account ? formatMinor(account.availableBalance, account.currency) : '—'}
              </span>
            </div>
            {delta !== null && (
              <p
                className={`text-[10px] ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-violet-400' : 'text-muted-foreground'}`}
                data-testid="balance-delta"
              >
                {delta > 0 ? '+' : ''}
                {formatMinor(delta, account?.currency)} last action
              </p>
            )}
            <p className="text-muted-foreground flex items-center gap-1.5 text-[9px]">
              <span
                className={`size-1 rounded-full ${report?.reconciled ? 'bg-emerald-400' : 'bg-muted-foreground'}`}
              />
              {report
                ? report.reconciled
                  ? 'Matches journal'
                  : 'Mismatch — refresh to confirm'
                : 'Waiting for journal check'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function FlowArrow({
  label,
  vertical = false,
  moving,
  tone,
}: {
  label: string;
  vertical?: boolean;
  moving: boolean;
  tone: string;
}) {
  const id = useId().replace(/:/g, '');
  return (
    <div className={`flow-arrow ${vertical ? 'flow-arrow-vertical' : ''}`} aria-hidden="true">
      <span>{label}</span>
      <svg viewBox={vertical ? '0 0 30 40' : '0 0 70 24'} preserveAspectRatio="none">
        <defs>
          <marker id={id} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6" fill={tone} />
          </marker>
        </defs>
        <path
          className={moving ? 'flow-edge-posted' : ''}
          d={vertical ? 'M15 0 L15 34' : 'M0 12 L64 12'}
          fill="none"
          stroke={tone}
          strokeWidth="1.3"
          markerEnd={`url(#${id})`}
        />
      </svg>
    </div>
  );
}

/** Diagram positions describe accounting relationships, never partial database commits. */
export function MoneyFlow(props: Props) {
  const { source, destination, operation, reports, before, transaction, entries, busy, error, replayed } =
    props;
  const active = Boolean(
    transaction &&
    props.lastOperation === operation &&
    (operation === 'deposit'
      ? transaction.toAccount === source?._id
      : transaction.fromAccount === source?._id) &&
    (operation === 'transfer' || operation === 'authorize'
      ? transaction?.toAccount === destination?._id
      : true)
  );
  const status = active ? transaction?.status : undefined;
  const posted = active && status === 'COMPLETED' && !replayed && !error && !busy;
  const tone = error ? '#d96070' : status === 'PENDING' ? '#bd9d59' : '#8275cd';
  const leftSystem = operation === 'deposit';
  const rightSystem = operation === 'withdraw';
  const left = leftSystem ? undefined : source;
  const right = rightSystem ? undefined : operation === 'deposit' ? source : destination;
  const debits = (entries ?? [])
    .filter((entry) => entry.entryType === 'DEBIT')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const credits = (entries ?? [])
    .filter((entry) => entry.entryType === 'CREDIT')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const state = busy
    ? 'Waiting for API'
    : error
      ? 'Request rejected'
      : replayed && active
        ? 'Retry result'
        : status === 'PENDING'
          ? 'Funds reserved'
          : status === 'COMPLETED'
            ? 'Posting confirmed'
            : status === 'CANCELLED'
              ? 'Reservation released'
              : 'Ready to run';
  return (
    <section className="ledger-flow" aria-label="Money data-flow diagram">
      <div className="flow-layout">
        <div className="flow-source">
          <AccountBlock
            account={left}
            system={leftSystem}
            index={0}
            report={left ? reports[left._id] : undefined}
            before={left ? before[left._id] : undefined}
            currency={source?.currency ?? 'INR'}
          />
        </div>
        <div className="flow-debit">
          <FlowArrow
            label={status === 'PENDING' ? 'reserve' : 'debit'}
            moving={Boolean(posted)}
            tone={tone}
          />
        </div>
        <div className={`flow-block flow-engine ${error ? 'flow-block-error' : ''}`}>
          <div className="flex items-center gap-2 border-b border-white/5 px-3 py-3">
            <Layers3 className="text-primary size-3.5" />
            <h2 className="text-xs font-medium">Ledger engine</h2>
          </div>
          <div className="space-y-2.5 px-3 py-3">
            <p className="flex items-center gap-1.5 text-[11px]">
              {busy ? (
                <LoaderCircle className="text-primary size-3.5 animate-spin" />
              ) : error ? (
                <CircleX className="text-destructive size-3.5" />
              ) : status === 'PENDING' ? (
                <Clock3 className="size-3.5 text-amber-400" />
              ) : (
                <ShieldCheck className="text-primary size-3.5" />
              )}
              {state}
            </p>
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              Validate funds.
              <br />
              Post both sides atomically.
            </p>
            <Badge variant="outline" className="h-4 text-[8px]">
              One database transaction
            </Badge>
          </div>
        </div>
        <div className="flow-credit">
          <FlowArrow
            label={status === 'PENDING' ? 'pending' : 'credit'}
            moving={Boolean(posted)}
            tone={tone}
          />
        </div>
        <div className="flow-destination">
          <AccountBlock
            account={right}
            system={rightSystem}
            index={operation === 'deposit' ? 0 : 1}
            report={right ? reports[right._id] : undefined}
            before={right ? before[right._id] : undefined}
            currency={source?.currency ?? 'INR'}
          />
        </div>
        <div className="flow-journal-arrow">
          <FlowArrow label="record" vertical moving={false} tone="#676178" />
        </div>
        <div className="flow-block flow-journal">
          <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
            <ShieldCheck className="size-3.5 text-emerald-400" />
            <h2 className="text-[11px] font-medium">Confirmed journal</h2>
            <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[8px]">
              {entries?.length ?? 0}
            </Badge>
          </div>
          <div className="space-y-1.5 px-3 py-2.5">
            {entries?.length ? (
              <>
                <div className="text-muted-foreground flex flex-wrap justify-between gap-1 text-[9px]">
                  <span>Debits {formatMinor(debits, transaction?.currency)}</span>
                  <span>Credits {formatMinor(credits, transaction?.currency)}</span>
                </div>
                <p className="flex items-center gap-1 text-[9px] text-emerald-400">
                  <CheckCircle2 className="size-3" />
                  {debits === credits ? 'Balanced posting' : 'Mismatch detected'}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-[9px] leading-relaxed">
                {transaction?.status === 'PENDING'
                  ? 'Reservation only. No posting.'
                  : transaction?.status === 'CANCELLED'
                    ? 'Released without posting.'
                    : 'Evidence appears after a payment.'}
              </p>
            )}
          </div>
        </div>
      </div>
      <p className="text-muted-foreground/60 flow-caption text-center text-[9px]">
        Arrows show the accounting relationship. A posted payment commits all writes together.
      </p>
    </section>
  );
}
