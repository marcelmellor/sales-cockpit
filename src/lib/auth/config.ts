import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

const ALLOWED_DOMAIN = 'sipgate.de';

export const authConfig: NextAuthConfig = {
  debug: process.env.NODE_ENV === 'development' || process.env.AUTH_DEBUG === 'true',
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Only allow users with @sipgate.de email
      const email = user.email;
      if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return false;
      }
      return true;
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  trustHost: true,
};
