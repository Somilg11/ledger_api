import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck, MailWarning } from 'lucide-react';
import { toast } from 'sonner';
import { api, type MockVerification } from '@/lib/api';
import { describeError } from '@/lib/useAsync';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

/**
 * Shows the link that a real deployment would have emailed.
 *
 * The API only returns it while mail is mocked, so there is nothing to show in
 * production — and nothing to leak.
 */
export function toastVerificationLink(verification: MockVerification | undefined, title: string) {
  if (!verification) {
    // Either mail is really being delivered, or the address was not eligible.
    // Either way the honest message is the same one a real system would give.
    toast.success(title, {
      description: 'If that address needs verifying, a link is on its way.',
    });
    return;
  }

  toast.success(title, {
    description: (
      <div className="space-y-2">
        <p>Mail is mocked, so the link is here instead. Copy it and open it in a new tab.</p>
        <code className="bg-muted text-muted-foreground block max-w-full overflow-x-auto rounded border px-2 py-1 font-mono text-[10px] whitespace-nowrap">
          {verification.link}
        </code>
      </div>
    ),
    action: {
      label: 'Copy',
      onClick: () => {
        void navigator.clipboard.writeText(verification.link);
        toast.success('Link copied');
      },
    },
    duration: 60_000,
  });
}

/** Prompts an unverified user and can re-issue the link. */
export function UnverifiedBanner() {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);

  if (!user || user.emailVerified !== false) return null;

  async function resend() {
    setSending(true);
    try {
      const result = await api.auth.resendVerification(user!.email);
      toastVerificationLink(result.verification, 'Verification link re-issued');
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-[var(--warning)]/25 bg-[var(--warning)]/10 mb-5 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      <MailWarning className="size-4 shrink-0 text-[var(--warning)]" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">Your email address is not verified</p>
        <p className="text-muted-foreground text-[12px]">
          {user.email} — re-issue the link, or open one you already have.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void resend()} disabled={sending}>
          {sending ? 'Sending…' : 'Resend link'}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/verify-email">Open verifier</Link>
        </Button>
      </div>
    </div>
  );
}

/** Small badge for a verified address, used on the dashboard. */
export function VerifiedBadge() {
  const { user } = useAuth();
  if (!user?.emailVerified) return null;

  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px]">
      <MailCheck className="size-3.5 text-[var(--credit)]" />
      email verified
    </span>
  );
}
