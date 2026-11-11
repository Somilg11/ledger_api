/** Geometric Ledger mark, drawn as vectors so it stays crisp at every size. */
export function LedgerLogo({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 90" className={className} aria-hidden="true">
      <path d="M16 13h20l23 48H39zM57 42h23l10 19H67z" fill="currentColor" />
      <path d="M16 13 8 28l23 48 8-15z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M39 61h20l-8 15H31zM67 61h23l-8 15H59z" fill="currentColor" opacity=".84" />
    </svg>
  );
}
