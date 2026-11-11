import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
const pages: Record<string, [string, string]> = {
  '/demo': [
    'Interactive Demo',
    'Explore Ledger: a double-entry banking simulation with transfers, safe retries, holds, reversals, and a live data-flow playground.',
  ],
  '/login': ['Sign in', 'Sign in to Ledger to explore your accounts and the simulated money playground.'],
  '/': ['Dashboard', 'Your Ledger account balances, reconciliation status, and activity.'],
  '/playground': [
    'Playground',
    'A money data-flow diagram with live account balances, API events, and journal evidence.',
  ],
  '/accounts': ['Accounts', 'Manage your simulated Ledger accounts.'],
  '/transfer': ['Move money', 'Transfer, deposit, withdraw, or reserve simulated funds.'],
  '/transactions': ['Transactions', 'Inspect transaction history and its journal entries.'],
  '/ledger': ['Journal', 'Inspect your double-entry journal and account reconciliation.'],
  '/admin': ['Administration', 'Administrative reconciliation, reversal, and audit tools.'],
  '/verify-email': ['Verify email', 'Confirm your Ledger email address.'],
};
export function PageMetadata() {
  const { pathname } = useLocation();
  useEffect(() => {
    const [title, description] = pages[pathname] ?? [
      'Ledger',
      'A double-entry ledger and banking simulation.',
    ];
    document.title = `${title} · Ledger`;
    const set = (selector: string, content: string) =>
      document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', content);
    set('meta[name="description"]', description);
    set('meta[property="og:title"]', document.title);
    set('meta[property="og:description"]', description);
    set('meta[name="twitter:title"]', document.title);
    set('meta[name="twitter:description"]', description);
    set('meta[name="robots"]', pathname === '/demo' ? 'index,follow' : 'noindex,nofollow');
    // Public demo canonical deliberately excludes token and query parameters.
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (pathname === '/demo') {
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.append(canonical);
      }
      canonical.href = `${window.location.origin}/demo`;
    } else canonical?.remove();
  }, [pathname]);
  return null;
}
