import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Sports, courts and the equipment catalogue are edited by an admin now and
      // then, not during a shift, so refetching them every 30 seconds bought
      // nothing and cost a round trip each time a screen remounted. Mutations
      // invalidate the keys they affect, which is what actually keeps this fresh.
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      // client.ts already retries once behind a token refresh; retrying a genuine
      // 4xx on top of that just delays the error the screen needs to show.
      retry: 1,
      refetchOnWindowFocus: false,
      // Navigating back to a screen should paint from cache and revalidate behind
      // it, not blank out and refetch.
      refetchOnMount: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
