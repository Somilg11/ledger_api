export function shortId(id?: string, length = 6): string {
  if (!id) return '—';
  return id.slice(-length);
}

export function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 45) return 'just now';
  const units: [number, string][] = [
    [60, 'm'],
    [3600, 'h'],
    [86400, 'd'],
  ];

  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.round(seconds / 86400)}d ago`;
  void units;

  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function absoluteTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
