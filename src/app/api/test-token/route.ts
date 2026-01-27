import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({
      error: 'No code provided',
      usage: 'Add ?code=YOUR_AUTH_CODE to test token exchange'
    });
  }

  const baseUrl = process.env.NEXTAUTH_URL || new URL(request.url).origin;
  const redirectUri = `${baseUrl}/api/auth/callback/hubspot`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.HUBSPOT_CLIENT_ID || '',
    client_secret: process.env.HUBSPOT_CLIENT_SECRET || '',
    redirect_uri: redirectUri,
    code: code,
  });

  console.log('Token request body:', {
    grant_type: 'authorization_code',
    client_id: process.env.HUBSPOT_CLIENT_ID?.substring(0, 8) + '...',
    client_secret: 'hidden',
    redirect_uri: redirectUri,
    code: code.substring(0, 10) + '...',
  });

  try {
    const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
    });

    const data = await response.json();

    return NextResponse.json({
      status: response.status,
      ok: response.ok,
      data: response.ok ? {
        access_token: 'received',
        expires_in: data.expires_in,
        token_type: data.token_type
      } : data,
    });
  } catch (error) {
    return NextResponse.json({
      error: 'Fetch failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
