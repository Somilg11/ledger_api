# Ledger Console

Simulation front end for the Ledger API. React 19 + Vite + Tailwind v4 +
shadcn/ui, themed after Linear: near-black canvas, hairline borders instead of
shadows, one indigo accent, 13px interface type and 6px radii.

```bash
npm install
npm run dev        # http://localhost:5173
```

The dev server proxies `/api`, `/health` and `/ready` to
`http://127.0.0.1:3000`. Point it elsewhere with `VITE_API_TARGET`:

```bash
VITE_API_TARGET=http://127.0.0.1:3177 npm run dev
```

Against the containerised stack, the console is already built and served by
nginx on **http://localhost:8080** — `npm run stack:up` from the repo root.

Proxying means the browser only ever talks to one origin, so the API's
deny-by-default CORS policy needs no exception. The container build does the
same thing with nginx.

## Screens

| Route           | What it does                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `/login`        | Sign in or register. Surfaces the API's password policy.                                                  |
| `/`             | Balances per currency, account list, merged activity feed, reconciliation status.                         |
| `/accounts`     | Open, rename, freeze and close accounts; per-account ledger reconciliation.                               |
| `/transfer`     | Transfer, deposit and withdraw, with a live idempotency-key control.                                      |
| `/transactions` | Statement per account; a detail sheet shows both ledger legs.                                             |
| `/ledger`       | The append-only journal, with cached vs ledger balance side by side.                                      |
| `/admin`        | System-wide debits==credits check, transaction reversal, account unfreeze. Admin only.                    |
| `/verify-email` | A mock of the verification message, with a Verify button. Public — the link is opened from a mail client. |

## Things worth clicking

- **Email verification.** Register a new account: mail is mocked, so the link
  arrives as a toast with a Copy button instead of an inbox. Paste it and you
  get a page laid out like the message itself. Pressing the button verifies;
  opening the link does not, so a mail scanner that pre-fetches URLs cannot
  confirm the address for you. The link is single-use, and resending supersedes
  it.

- **Idempotency.** The Move money form shows the key it will send. Submit the
  same form twice without regenerating: the same transaction comes back and the
  balance moves once. Change the amount but keep the key and the API returns
  409 by design — the form then offers to rotate the key.
- **Reconciliation.** Every balance is shown next to the sum of the journal.
  `reconciled: false` would mean the cached balance drifted from the ledger.
- **Authorisation.** The Admin link is hidden for normal users, and the route
  redirects; the API independently returns 403. Reading an account you do not
  own returns 404, so account ids cannot be probed.

## Tests

```bash
npm run test:ui     # works from web/ or from the repo root
```

`tests/ui.smoke.mjs` drives real Chrome through all six screens and asserts what
a type check cannot: that displayed money matches what the API holds, that an
idempotent replay moves money only once (it reads the balance before and after),
and that a normal user never reaches the admin surface.

It probes :5173 and :8080 and uses whichever is serving, so it works against the
dev server or the container without configuration. Override with `BASE_URL`, and
point at a different browser with `CHROME_PATH`.

## Money

The API speaks integer minor units (paise/cents) and rejects decimals and
numeric strings. Conversion lives in `src/lib/money.ts` and nowhere else — no
component does float arithmetic on money.

## Structure

```
src/
├── lib/
│   ├── api.ts        typed client, token refresh with single-flight rotation
│   ├── auth.tsx      session context, server-verified on boot
│   ├── money.ts      minor-unit parsing and formatting
│   └── useAsync.ts   load/reload hook and error narrowing
├── components/
│   ├── ui/           shadcn primitives (Radix base)
│   ├── Layout.tsx    sidebar shell
│   └── primitives.tsx  Money, StatusBadge, IdChip, EmptyState, PageHeader
└── routes/           one file per screen
```
