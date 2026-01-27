import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    env: {
      HUBSPOT_CLIENT_ID: process.env.HUBSPOT_CLIENT_ID ? `set (${process.env.HUBSPOT_CLIENT_ID.substring(0, 8)}...)` : 'NOT SET',
      HUBSPOT_CLIENT_SECRET: process.env.HUBSPOT_CLIENT_SECRET ? 'set (hidden)' : 'NOT SET',
      AUTH_SECRET: process.env.AUTH_SECRET ? 'set (hidden)' : 'NOT SET',
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? 'set (hidden)' : 'NOT SET',
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'NOT SET',
      NODE_ENV: process.env.NODE_ENV,
    },
  });
}
