import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Inbox, Landmark, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { describeError } from '@/lib/useAsync';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';

type State = 'idle' | 'working' | 'verified' | 'failed';

/**
 * Stands in for the email a real deployment would send.
 *
 * The page is laid out like a message rather than a form on purpose: the token
 * arrives in a link, the recipient reads a short explanation, and one button
 * completes the action. Verification is a POST from this page, never a side
 * effect of opening the link — a mail scanner that pre-fetches URLs would
 * otherwise verify addresses on the recipient's behalf.
 */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const { user, refreshProfile } = useAuth();

  // The URL is the source of truth when it carries a token; the input only
  // backs the paste-it-yourself case.
  const urlToken = params.get('token') ?? '';
  const [pastedToken, setPastedToken] = useState('');
  const token = urlToken || pastedToken;
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);

  async function verify() {
    if (!token.trim()) {
      setError('Paste the verification link or token first');
      return;
    }

    setState('working');
    setError(null);
    try {
      // Accept a full pasted link as well as a bare token — people paste links.
      let value = token.trim();
      if (value.includes('token=')) {
        value = decodeURIComponent(value.split('token=')[1].split('&')[0]);
      }

      const result = await api.auth.verifyEmail(value);
      setVerifiedEmail(result.email);
      setState('verified');
      toast.success('Email verified');
      await refreshProfile();
    } catch (err) {
      setError(describeError(err));
      setState('failed');
    }
  }

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[520px]">
        {/* The envelope: who it is from, and that nothing was really sent. */}
        <div className="text-muted-foreground mb-3 flex items-center gap-2 px-1 text-[11px]">
          <Inbox className="size-3.5" />
          Mock inbox — this message was never delivered anywhere
        </div>

        <div className="bg-card surface-edge overflow-hidden rounded-xl border">
          <div className="border-border flex items-center gap-3 border-b px-5 py-4">
            <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Landmark className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">Ledger</p>
              <p className="text-muted-foreground truncate font-mono text-[11px]">no-reply@ledger.test</p>
            </div>
          </div>

          <div className="space-y-5 px-6 py-7">
            {state === 'verified' ? (
              <div className="space-y-4 text-center">
                <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-[var(--credit)]/10">
                  <CheckCircle2 className="size-5 text-[var(--credit)]" />
                </div>
                <div className="space-y-1.5">
                  <h1 className="text-[16px] font-semibold tracking-tight">Email verified</h1>
                  <p className="text-muted-foreground text-[13px]">
                    {verifiedEmail} is confirmed. The link has been used and will not work again.
                  </p>
                </div>
                <Button asChild size="sm">
                  <Link to={user ? '/' : '/login'}>{user ? 'Back to the console' : 'Sign in'}</Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <h1 className="text-[17px] font-semibold tracking-tight">Confirm your email address</h1>
                  <p className="text-muted-foreground text-[13px] leading-relaxed">
                    Confirm this address to finish setting up your Ledger account. The link is single-use and
                    expires in 24 hours. If you did not create an account, ignore this message — nothing will
                    happen.
                  </p>
                </div>

                {!urlToken && (
                  <div className="space-y-1.5">
                    <Label htmlFor="token">Verification link or token</Label>
                    <Input
                      id="token"
                      value={token}
                      onChange={(e) => setPastedToken(e.target.value)}
                      placeholder="http://localhost:8080/verify-email?token=…"
                      className="font-mono text-[11px]"
                    />
                  </div>
                )}

                {error && (
                  <Alert variant="destructive">
                    <XCircle className="size-4" />
                    <AlertDescription className="text-[12px]">{error}</AlertDescription>
                  </Alert>
                )}

                <Button
                  onClick={() => void verify()}
                  disabled={state === 'working'}
                  className="w-full"
                  size="lg"
                >
                  {state === 'working' ? 'Verifying…' : 'Verify email address'}
                </Button>

                <p className="text-muted-foreground border-border border-t pt-4 text-[11px] leading-relaxed">
                  You are receiving this because someone signed up with this address. Verification is
                  completed by pressing the button, not by opening the link, so a mail scanner that follows
                  URLs cannot confirm the address for you.
                </p>
              </>
            )}
          </div>
        </div>

        <p className="text-muted-foreground mt-4 text-center text-[11px]">
          <Link to="/login" className="hover:text-foreground underline underline-offset-2">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
