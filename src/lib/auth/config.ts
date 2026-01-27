import type { NextAuthConfig } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

const HUBSPOT_SCOPES = [
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.owners.read',
  'crm.schemas.deals.read',
  'oauth',
].join(' ');

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.HUBSPOT_CLIENT_ID?.trim() || '',
        client_secret: process.env.HUBSPOT_CLIENT_SECRET?.trim() || '',
        refresh_token: token.refreshToken as string,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      throw refreshedTokens;
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
      expiresAt: Date.now() + refreshedTokens.expires_in * 1000,
    };
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return {
      ...token,
      error: 'RefreshAccessTokenError',
    };
  }
}

export const authConfig: NextAuthConfig = {
  debug: process.env.NODE_ENV === 'development' || process.env.AUTH_DEBUG === 'true',
  providers: [
    {
      id: 'hubspot',
      name: 'HubSpot',
      type: 'oauth',
      // Disable PKCE - HubSpot uses standard OAuth 2.0 without PKCE
      checks: ['state'],
      // Force client credentials to be sent in request body (not Basic Auth)
      client: {
        token_endpoint_auth_method: 'client_secret_post',
      },
      authorization: {
        url: 'https://app-eu1.hubspot.com/oauth/authorize',
        params: {
          scope: HUBSPOT_SCOPES,
        },
      },
      token: 'https://api.hubapi.com/oauth/v1/token',
      userinfo: {
        url: 'https://api.hubapi.com/oauth/v1/access-tokens',
        async request({ tokens }: { tokens: { access_token?: string } }) {
          const response = await fetch(
            `https://api.hubapi.com/oauth/v1/access-tokens/${tokens.access_token}`
          );
          return response.json();
        },
      },
      profile(profile: { user_id?: number; hub_id?: number; user?: string }) {
        return {
          id: profile.user_id?.toString() || profile.hub_id?.toString(),
          name: profile.user || 'HubSpot User',
          email: profile.user,
          hubId: profile.hub_id,
        };
      },
      clientId: process.env.HUBSPOT_CLIENT_ID?.trim(),
      clientSecret: process.env.HUBSPOT_CLIENT_SECRET?.trim(),
    },
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // Initial sign-in: store tokens
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = Date.now() + (account.expires_in as number) * 1000;
        token.hubId = (profile as { hub_id?: number })?.hub_id;
      }

      // Return token if not expired (with 5 minute buffer)
      if (token.expiresAt && Date.now() < token.expiresAt - 5 * 60 * 1000) {
        return token;
      }

      // Refresh expired token
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.hubId = token.hubId as number;
      session.error = token.error as string | undefined;
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
