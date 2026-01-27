'use client';

import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  highlighted?: boolean;
  onClick?: () => void;
}

export function Card({ children, className = '', highlighted = false, onClick }: CardProps) {
  return (
    <div
      className={`
        bg-white rounded-lg border border-gray-200 p-4
        ${highlighted ? 'bg-yellow-50 border-yellow-200' : ''}
        ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}
        ${className}
      `}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`font-semibold text-sm text-gray-700 mb-2 pb-2 border-b border-gray-100 ${className}`}>
      {children}
    </div>
  );
}

export function CardContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`text-sm text-gray-600 ${className}`}>{children}</div>;
}
