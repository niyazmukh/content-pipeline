import React from 'react';

export const LoaderIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
    <path
      d="M22 12a10 10 0 0 1-10 10"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
    />
  </svg>
);

export const SparklesIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 2l1.2 4.2L17.4 8 13.2 9.2 12 13.4 10.8 9.2 6.6 8l4.2-1.8L12 2z"
      fill="currentColor"
      opacity="0.9"
    />
    <path
      d="M19 12l.9 3.1L23 16l-3.1.9L19 20l-.9-3.1L15 16l3.1-.9L19 12z"
      fill="currentColor"
      opacity="0.75"
    />
    <path
      d="M5 13l.9 3.1L9 17l-3.1.9L5 21l-.9-3.1L1 17l3.1-.9L5 13z"
      fill="currentColor"
      opacity="0.75"
    />
  </svg>
);

