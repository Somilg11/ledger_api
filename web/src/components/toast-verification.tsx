import { toast } from 'sonner';
import type { MockVerification } from '@/lib/api';

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
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(verification.link);
          toast.success('Link copied');
        } catch {
          toast.error('Copy failed. Select the verification link to copy it manually.');
        }
      },
    },
    duration: 60_000,
  });
}
