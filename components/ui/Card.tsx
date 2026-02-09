import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  action?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ children, className = '', title, description, footer, action }) => (
  <section className={`bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg backdrop-blur-sm ${className}`}>
    {(title || action) && (
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          {title && <h2 className="text-lg font-semibold text-slate-100 truncate">{title}</h2>}
          {description && <div className="text-sm text-slate-400 mt-1">{description}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    )}
    <div className="text-slate-200">
      {children}
    </div>
    {footer && (
      <div className="mt-6 border-t border-slate-800 pt-4 text-sm text-slate-400">
        {footer}
      </div>
    )}
  </section>
);
