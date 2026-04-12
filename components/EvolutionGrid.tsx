'use client';
import { useState } from 'react';

export default function EvolutionGrid({ steps }: { steps: any[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {steps.map((step) => (
          <div key={step.n}
            onClick={() => setOpen(open === step.n ? null : step.n)}
            className="bg-hive-bg2 border border-hive-border rounded-[10px] p-6 hover:border-hive-gold/20 transition-all duration-300 hover:-translate-y-[2px] cursor-pointer group">
            <div className="flex justify-between items-center mb-4">
              <span className="text-[26px]">{step.icon}</span>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[10px] ${step.color} font-semibold`}>{step.n}</span>
                <span className="text-[10px] text-hive-dim group-hover:text-hive-gold transition-colors">{open === step.n ? '▲' : '▼'}</span>
              </div>
            </div>
            <h3 className="text-base font-bold text-hive-text mb-2">{step.title}</h3>
            <p className="text-[13px] text-hive-sub leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>
      {open && (() => {
        const step = steps.find(s => s.n === open);
        if (!step) return null;
        return (
          <div className="mt-4 bg-hive-bg2 border border-hive-gold/25 rounded-[10px] p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[24px]">{step.icon}</span>
              <h3 className="text-[16px] font-black text-hive-gold">{step.title}</h3>
            </div>
            <p className="text-[13px] text-hive-sub leading-[1.75]">{step.expanded}</p>
          </div>
        );
      })()}
    </>
  );
}
