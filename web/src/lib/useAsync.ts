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
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });

  // Holds the latest loader without making it part of the dependency list.
  // Written in an effect rather than during render: mutating a ref while
  // rendering is unsafe under concurrent rendering, where a render may be
  // discarded.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  const run = useCallback(async () => {
    try {
      const data = await loaderRef.current();
      setState({ data, error: null, loading: false });
    } catch (err) {
      setState({ data: null, error: describeError(err), loading: false });
    }
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(async () => {
    // Only a manual reload flips the spinner back on; the initial load starts
    // in the loading state already.
    setState((current) => ({ ...current, loading: true }));
    await run();
  }, [run]);

  return { ...state, reload };
}
