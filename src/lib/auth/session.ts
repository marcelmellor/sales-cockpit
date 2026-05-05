import type { Session } from 'next-auth';
import { auth } from './index';

const AUTH_DISABLED = process.env.NEXT_PUBLIC_AUTH_DISABLED === 'true';

/**
 * Server-side session getter. In local dev with NEXT_PUBLIC_AUTH_DISABLED=true,
 * returns a fake session so API routes don't need auth. In production, defers
 * to NextAuth's `auth()` which validates the JWT.
 */
export async function getSession(): Promise<Session | null> {
  if (AUTH_DISABLED) {
    return {
      user: {
        name: 'Dev User',
        email: 'dev@sipgate.de',
        image: null,
      },
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    } as Session;
  }
  return auth();
}
