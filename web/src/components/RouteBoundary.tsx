import { Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PageLoading } from '@/components/PageLoading';
export function RouteBoundary({ children, fullPage = false }: { children: ReactNode; fullPage?: boolean }) {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.key} scope="This page" fullPage={fullPage}>
      <Suspense fallback={<PageLoading fullPage={fullPage} />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
