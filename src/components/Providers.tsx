'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { ReactNode, useState } from 'react';
import type { Session } from 'next-auth';

interface ProvidersProps {
  children: ReactNode;
}

const AUTH_DISABLED = process.env.NEXT_PUBLIC_AUTH_DISABLED === 'true';

// Local dev with NEXT_PUBLIC_AUTH_DISABLED=true: inject a static fake session
// so useSession() returns "authenticated" without an OAuth flow. Production
// leaves session={undefined} → SessionProvider fetches real session via /api/auth.
const FAKE_SESSION: Session | undefined = AUTH_DISABLED
  ? {
      user: {
        name: 'Dev User',
        email: 'dev@sipgate.de',
        image: null,
      },
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    }
  : undefined;

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <SessionProvider
      session={FAKE_SESSION}
      refetchOnWindowFocus={!AUTH_DISABLED}
      refetchInterval={AUTH_DISABLED ? 0 : undefined}
    >
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </SessionProvider>
  );
}
