import React from 'react';

type HelpTipProps = {
  label: string;
};

const HelpTip: React.FC<HelpTipProps> = ({ label }) => (
  <span
    className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-700 bg-slate-950/60 text-slate-300 text-[10px] leading-none align-middle cursor-help"
    title={label}
    aria-label={label}
    role="img"
  >
    ?
  </span>
);

export default HelpTip;

