import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck, MailWarning } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { describeError } from '@/lib/useAsync';
import { useAuth } from '@/lib/auth-context';
import { toastVerificationLink } from '@/components/toast-verification';
import { Button } from '@/components/ui/button';

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
