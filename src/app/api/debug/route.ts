import { NextResponse } from 'next/server';

export async function GET() {
  // NextAuth v5 uses AUTH_SECRET and AUTH_URL primarily
  const hasAuthSecret = !!process.env.AUTH_SECRET;
  const hasNextAuthSecret = !!process.env.NEXTAUTH_SECRET;
  const hasAnySecret = hasAuthSecret || hasNextAuthSecret;

  return NextResponse.json({
    env: {
      HUBSPOT_CLIENT_ID: process.env.HUBSPOT_CLIENT_ID ? `set (${process.env.HUBSPOT_CLIENT_ID.substring(0, 8)}...)` : 'NOT SET',
      HUBSPOT_CLIENT_SECRET: process.env.HUBSPOT_CLIENT_SECRET ? `set (${process.env.HUBSPOT_CLIENT_SECRET.substring(0, 8)}...)` : 'NOT SET',
      AUTH_SECRET: hasAuthSecret ? 'set (hidden)' : 'NOT SET',
      NEXTAUTH_SECRET: hasNextAuthSecret ? 'set (hidden)' : 'NOT SET',
      AUTH_URL: process.env.AUTH_URL || 'NOT SET',
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'NOT SET',
      NODE_ENV: process.env.NODE_ENV,
    },
    warnings: !hasAnySecret
      ? ['CRITICAL: Neither AUTH_SECRET nor NEXTAUTH_SECRET is set! Logout will not work.']
      : (!hasAuthSecret ? ['AUTH_SECRET not set, falling back to NEXTAUTH_SECRET'] : []),
  });
}
