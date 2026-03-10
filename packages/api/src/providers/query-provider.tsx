import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';

interface QueryProviderProps {
  children: ReactNode;
  client?: QueryClient;
}

/**
 * Default query client configuration
 */
const createDefaultQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 0,
      },
      mutations: {
        retry: 0,
      },
    },
  });

/**
 * React Query provider component
 */
export const QueryProvider = ({ children, client }: QueryProviderProps) => {
  const [queryClient] = useState(() => client || createDefaultQueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};
