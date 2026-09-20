import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = err.fieldErrors;
    return fields.length > 0 ? `${err.message} — ${fields.join('; ')}` : err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Loads data on mount and whenever `deps` change, with a manual reload hook. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Keeps the latest loader without making it part of the dependency list.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loaderRef.current());
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload: run };
}
