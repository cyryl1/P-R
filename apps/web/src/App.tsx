import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { createRouter } from './routes';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // Don't retry errors the server answered deliberately.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status > 0) && count < 2,
      },
    },
  });
}

export function App() {
  const [queryClient] = useState(makeQueryClient);
  const [router] = useState(createRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
