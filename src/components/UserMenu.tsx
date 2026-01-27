'use client';

import { signOut, useSession } from 'next-auth/react';
import { LogOut, User } from 'lucide-react';
import { useEffect } from 'react';

export function UserMenu() {
  const { data: session, status } = useSession();

  // Handle token refresh errors
  useEffect(() => {
    if (session?.error === 'RefreshAccessTokenError') {
      signOut({ callbackUrl: '/login?error=RefreshAccessTokenError' });
    }
  }, [session?.error]);

  if (status === 'loading') {
    return (
      <div className="h-8 w-8 rounded-full bg-gray-200 animate-pulse" />
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <User className="h-4 w-4" />
        <span>{session.user?.email || 'HubSpot User'}</span>
      </div>
      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
      >
        <LogOut className="h-4 w-4" />
        Abmelden
      </button>
    </div>
  );
}
