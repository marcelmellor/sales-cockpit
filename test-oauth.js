// Test HubSpot OAuth Token Exchange
const fs = require('fs');

// Read .env.local file
const envContent = fs.readFileSync('.env.local', 'utf8');
const CLIENT_ID = envContent.match(/HUBSPOT_CLIENT_ID="(.+)"/)?.[1];
const CLIENT_SECRET = envContent.match(/HUBSPOT_CLIENT_SECRET="(.+)"/)?.[1];
const REDIRECT_URI = 'http://localhost:4000/api/auth/callback/hubspot';

console.log('Testing HubSpot OAuth Configuration\n');
console.log('Client ID:', CLIENT_ID);
console.log('Client Secret:', CLIENT_SECRET ? `${CLIENT_SECRET.substring(0, 8)}...` : 'MISSING');
console.log('Redirect URI:', REDIRECT_URI);
console.log('\n--- Testing Token Exchange Endpoint ---\n');

// Simulate a token exchange request (will fail without real code, but shows us the error)
async function testTokenExchange() {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code: 'test-code-will-fail-but-shows-error-type',
  });

  try {
    const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();

    console.log('Response Status:', response.status);
    console.log('Response Body:', JSON.stringify(data, null, 2));

    if (data.status === 'BAD_CLIENT_ID') {
      console.log('\n❌ BAD_CLIENT_ID Error!');
      console.log('This means the Client ID or Client Secret is incorrect.');
      console.log('Please verify these values in the HubSpot Developer Portal.');
    } else if (data.status === 'INVALID_GRANT') {
      console.log('\n✅ Client ID and Secret are CORRECT!');
      console.log('(INVALID_GRANT is expected with a fake code)');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testTokenExchange();
