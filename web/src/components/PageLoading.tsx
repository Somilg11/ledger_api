import { Skeleton } from '@/components/ui/skeleton';
export function PageLoading({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className={`space-y-5 p-5 ${fullPage ? 'bg-background h-dvh overflow-hidden' : ''}`}
    >
      <span className="sr-only">Loading page…</span>
      <Skeleton className="h-6 w-36" />
      <Skeleton className="h-3 w-2/3 max-w-md" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}
