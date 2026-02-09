import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'neutral' | 'outline';
  className?: string;
  title?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default', className = '', title }) => {
  const colors = {
    default: 'bg-blue-950/50 text-blue-300 border-blue-900/50',
    success: 'bg-emerald-950/50 text-emerald-300 border-emerald-900/50',
    warning: 'bg-amber-950/50 text-amber-300 border-amber-900/50',
    error: 'bg-red-950/50 text-red-300 border-red-900/50',
    neutral: 'bg-slate-800/50 text-slate-300 border-slate-700/50',
    outline: 'bg-transparent text-slate-400 border-slate-700',
  };
  return (
    <span 
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colors[variant]} ${className}`}
      title={title}
    >
      {children}
    </span>
  );
};
