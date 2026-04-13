'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    if (sessionId) setStatus('success');
    else setStatus('error');
  }, [sessionId]);

  if (status === 'loading') return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-hive-gold text-[14px]">Confirming your membership...</div>
    </div>
  );

  return (
    <section className="max-w-[560px] mx-auto px-6 pt-28 pb-20 text-center">
      <div className="bg-hive-bg2 border border-hive-gold/25 rounded-[12px] p-10">
        <div className="text-[64px] mb-4">🐝</div>
        <h2 className="font-serif text-[28px] font-black text-hive-gold mb-3">
          Welcome to the Colony
        </h2>
        <p className="text-hive-sub text-[14px] leading-[1.7] mb-6">
          Payment confirmed. Your membership is active. The colony is ready for you.
          Complete your First Flight to unlock full access.
        </p>
        <div className="space-y-3">
          <Link href="/join" className="block w-full bg-gradient-to-br from-hive-gold to-[#D4860B] text-hive-bg py-3 rounded-[8px] font-bold text-[14px]">
            Complete Registration →
          </Link>
          <Link href="/first-flight" className="block w-full border border-hive-gold/30 text-hive-gold py-3 rounded-[8px] font-semibold text-[13px] hover:bg-hive-gold/5 transition-colors">
            Go to First Flight
          </Link>
          <Link href="/honeycombs" className="block w-full border border-hive-border text-hive-muted py-3 rounded-[8px] font-semibold text-[13px] hover:border-hive-gold/20 transition-colors">
            Explore Honeycombs
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div className="pt-28 text-center text-hive-muted">Loading...</div>}>
      <SuccessContent />
    </Suspense>
  );
}
