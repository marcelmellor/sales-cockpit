'use client';

import { Printer } from 'lucide-react';
import { printCanvas } from '@/lib/pdf-export';

interface ExportButtonProps {
  disabled?: boolean;
}

export function ExportButton({ disabled }: ExportButtonProps) {
  return (
    <button
      onClick={printCanvas}
      disabled={disabled}
      className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="Drucken / Als PDF speichern"
    >
      <Printer className="h-5 w-5" />
    </button>
  );
}
