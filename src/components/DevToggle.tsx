'use client';

import { useDevStore } from '@/stores/dev-store';
import { Bug } from 'lucide-react';

export function DevToggle() {
  const { devMode, toggleDevMode } = useDevStore();

  if (process.env.NODE_ENV !== 'development') return null;

  return (
    <button
      onClick={toggleDevMode}
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg transition-colors ${
        devMode
          ? 'bg-amber-500 text-white'
          : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
      }`}
      title="Dev Mode Toggle"
    >
      <Bug size={14} />
      {devMode ? 'DEV' : 'dev'}
    </button>
  );
}
