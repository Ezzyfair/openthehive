'use client';

import { useEffect, useState, useRef } from 'react';

// Shared typing animation component used in both LiveHivePulse and Honeycomb pages
// Props: message content, whether to animate (newest message only), agent color

const CHARS_PER_TICK = 1;
const TYPING_INTERVAL_MS = 30;
const MAX_CONTENT = 320;

function truncate(t: string) {
  return t.length > MAX_CONTENT ? t.slice(0, MAX_CONTENT) + '…' : t;
}

interface HoneycombMessageProps {
  content: string;
  animate?: boolean;       // true = type it out
  agentColor?: string;     // for cursor color
  className?: string;
  onComplete?: () => void;
}

export function HoneycombMessage({
  content, animate = false, agentColor = '#F5A623', className = '', onComplete
}: HoneycombMessageProps) {
  const full = truncate(content);
  const [displayed, setDisplayed] = useState(animate ? '' : full);
  const [done, setDone] = useState(!animate);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const iRef = useRef(0);

  useEffect(() => {
    if (!animate) { setDisplayed(full); setDone(true); return; }
    iRef.current = 0;
    setDisplayed('');
    setDone(false);

    intervalRef.current = setInterval(() => {
      iRef.current += CHARS_PER_TICK;
      setDisplayed(full.slice(0, iRef.current));
      if (iRef.current >= full.length) {
        clearInterval(intervalRef.current!);
        setDone(true);
        onComplete?.();
      }
    }, TYPING_INTERVAL_MS);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [animate, full]);

  return (
    <span className={className}>
      {displayed}
      {!done && (
        <span
          className="inline-block w-[2px] h-[14px] ml-[2px] align-middle"
          style={{ backgroundColor: agentColor, animation: 'blink 0.7s step-end infinite' }}
        />
      )}
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </span>
  );
}

// Thinking dots component
export function ThinkingDots({ color = '#F5A623' }: { color?: string }) {
  return (
    <div className="flex items-center gap-[5px] h-[22px]">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="block w-[8px] h-[8px] rounded-full"
          style={{
            backgroundColor: color,
            animation: 'thinking-dot 1.2s ease-in-out infinite',
            animationDelay: `${i * 200}ms`,
          }}
        />
      ))}
      <style>{`
        @keyframes thinking-dot {
          0%,80%,100% { transform:scale(0.6); opacity:0.3; }
          40% { transform:scale(1); opacity:1; }
        }
      `}</style>
    </div>
  );
}
