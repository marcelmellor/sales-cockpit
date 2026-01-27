'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function HubSpotLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.984 2.21 2.21 0 00-2.212-2.212 2.21 2.21 0 00-2.212 2.212c0 .857.49 1.599 1.205 1.964v2.862a5.052 5.052 0 00-2.268 1.09L7.46 4.17a2.062 2.062 0 00.095-.607 2.074 2.074 0 00-2.074-2.074 2.074 2.074 0 00-2.074 2.074 2.074 2.074 0 002.074 2.074c.357 0 .693-.092.987-.253l6.44 4.826a5.065 5.065 0 00-.64 2.457 5.065 5.065 0 00.657 2.494l-1.94 1.94a1.881 1.881 0 00-.586-.096 1.9 1.9 0 00-1.9 1.9 1.9 1.9 0 001.9 1.9 1.9 1.9 0 001.9-1.9c0-.21-.035-.412-.096-.6l1.92-1.92a5.053 5.053 0 002.898.92 5.067 5.067 0 005.068-5.067 5.067 5.067 0 00-3.924-4.937zm-1.008 7.753a2.786 2.786 0 01-2.788-2.788 2.786 2.786 0 012.788-2.788 2.786 2.786 0 012.788 2.788 2.786 2.786 0 01-2.788 2.788z" />
    </svg>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const error = searchParams.get('error');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Sales Canvas</h1>
          <p className="mt-2 text-gray-600">
            Melden Sie sich mit Ihrem HubSpot-Account an
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
            <p className="text-red-700 text-sm">
              {error === 'RefreshAccessTokenError'
                ? 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.'
                : 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.'}
            </p>
          </div>
        )}

        <button
          onClick={() => signIn('hubspot', { callbackUrl })}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-[#ff7a59] text-white rounded-lg hover:bg-[#ff5c35] transition-colors font-medium cursor-pointer"
        >
          <HubSpotLogo className="h-6 w-6" />
          Mit HubSpot anmelden
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <LoginContent />
    </Suspense>
  );
}
