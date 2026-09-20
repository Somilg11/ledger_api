import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMinor } from '@/lib/money';
import { shortId } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** Page header: title, one-line explanation, and the page's primary actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
      <div className="space-y-1">
        <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground max-w-prose text-[13px]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Money, right-aligned, tabular, and coloured by direction when asked. */
export function Money({
  minor,
  currency = 'INR',
  tone = 'neutral',
  className,
}: {
  minor: number;
  currency?: string;
  tone?: 'neutral' | 'credit' | 'debit' | 'auto';
  className?: string;
}) {
  const resolved = tone === 'auto' ? (minor < 0 ? 'debit' : 'credit') : tone;
  return (
    <span
      className={cn(
        'tabular font-medium',
        resolved === 'credit' && 'text-[var(--credit)]',
        resolved === 'debit' && 'text-[var(--debit)]',
        className
      )}
    >
      {tone === 'credit' && minor > 0 ? '+' : ''}
      {formatMinor(minor, currency)}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-[var(--credit)]/25 bg-[var(--credit)]/10 text-[var(--credit)]',
  COMPLETED: 'border-[var(--credit)]/25 bg-[var(--credit)]/10 text-[var(--credit)]',
  FROZEN: 'border-[var(--info)]/25 bg-[var(--info)]/10 text-[var(--info)]',
  PENDING: 'border-[var(--warning)]/25 bg-[var(--warning)]/10 text-[var(--warning)]',
  REVERSED: 'border-[var(--warning)]/25 bg-[var(--warning)]/10 text-[var(--warning)]',
  CLOSED: 'border-border bg-muted text-muted-foreground',
  FAILED: 'border-destructive/25 bg-destructive/10 text-destructive',
  DEBIT: 'border-[var(--debit)]/25 bg-[var(--debit)]/10 text-[var(--debit)]',
  CREDIT: 'border-[var(--credit)]/25 bg-[var(--credit)]/10 text-[var(--credit)]',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 rounded px-1.5 text-[11px] font-medium tracking-wide',
        STATUS_STYLES[status] ?? 'border-border bg-muted text-muted-foreground',
        className
      )}
    >
      {status}
    </Badge>
  );
}

/** Long Mongo ids are unreadable; show the tail and let the user copy the whole thing. */
export function IdChip({ id, label }: { id?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="text-muted-foreground">—</span>;

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="text-muted-foreground hover:text-foreground hover:border-border group inline-flex items-center gap-1.5 rounded border border-transparent px-1.5 py-0.5 font-mono text-[11px] transition-colors"
      title={id}
    >
      {label ?? `…${shortId(id)}`}
      {copied ? (
        <Check className="size-3 text-[var(--credit)]" />
      ) : (
        <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

/** A designed empty state, rather than a blank region that reads as a bug. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="border-border bg-muted/40 flex size-10 items-center justify-center rounded-lg border">
        <Icon className="text-muted-foreground size-4" />
      </div>
      <div className="space-y-1">
        <p className="text-[13px] font-medium">{title}</p>
        {description && <p className="text-muted-foreground max-w-xs text-[12px]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Key/value row used in detail panels. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-muted-foreground shrink-0 text-[12px]">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px]">{children}</span>
    </div>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-destructive flex items-start gap-1.5 text-[12px]" role="alert">
      {message}
    </p>
  );
}

export function SubmitButton({
  pending,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button size="sm" disabled={pending || props.disabled} {...props}>
      {pending ? 'Working…' : children}
    </Button>
  );
}
