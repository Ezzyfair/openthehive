// ConfettiGraduation.tsx — fires when bee status flips to 'active'
'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Props { agentId: string; }

const COLORS = ['#E2C46A','#C9A84C','#F2EDE4','#1E1610','#E2C46A','#C9A84C'];

function fireWave(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const particles: any[] = [];
  for (let i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * 0.4,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 4 + 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: Math.random() * 8 + 4,
      rotation: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 8,
      life: 1,
    });
  }
  let frame = 0;
  function draw() {
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.1;
      p.rotation += p.rotV; p.life -= 0.012;
      ctx!.save();
      ctx!.globalAlpha = Math.max(0, p.life);
      ctx!.fillStyle = p.color;
      ctx!.translate(p.x, p.y);
      ctx!.rotate((p.rotation * Math.PI) / 180);
      ctx!.fillRect(-p.size/2, -p.size/4, p.size, p.size/2);
      ctx!.restore();
    });
    frame++;
    if (frame < 160) requestAnimationFrame(draw);
    else ctx!.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}

export default function ConfettiGraduation({ agentId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graduated, setGraduated] = useState(false);
  const [show, setShow] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!agentId || graduated) return;
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('agents')
        .select('status')
        .eq('id', agentId)
        .single();
      if (data?.status === 'active') {
        setGraduated(true);
        setShow(true);
        clearInterval(pollRef.current!);
        // Three waves 3s apart
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        fireWave(canvas);
        setTimeout(() => fireWave(canvas), 3000);
        setTimeout(() => fireWave(canvas), 6000);
        // Play graduation sound if audio enabled
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(523, ctx.currentTime);
          osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15);
          osc.frequency.setValueAtTime(784, ctx.currentTime + 0.3);
          osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.5);
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 1.5);
        } catch(e) { /* audio not available */ }
        // Hide after 8s
        setTimeout(() => setShow(false), 8000);
      }
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [agentId, graduated]);

  if (!show) return null;
  return (
    <>
      <canvas ref={canvasRef}
        style={{ position:'fixed', inset:0, width:'100vw', height:'100vh',
          pointerEvents:'none', zIndex:9999 }} />
      <div style={{ position:'fixed', top:'50%', left:'50%',
        transform:'translate(-50%,-50%)', zIndex:10000,
        textAlign:'center', pointerEvents:'none',
        animation:'grad-appear 0.5s ease forwards' }}>
        <div style={{ fontFamily:'Cinzel,serif', fontSize:'clamp(24px,5vw,48px)',
          color:'#E2C46A', textShadow:'0 0 40px rgba(226,196,106,0.8)',
          letterSpacing:'0.2em', marginBottom:12 }}>🐝 GRADUATED 🐝</div>
        <div style={{ fontFamily:'Cormorant Garamond,serif', fontStyle:'italic',
          fontSize:'clamp(16px,3vw,24px)', color:'rgba(212,196,170,0.9)' }}>
          You are becoming an agent that builds.
        </div>
      </div>
      <style>{`@keyframes grad-appear{from{opacity:0;transform:translate(-50%,-60%)}to{opacity:1;transform:translate(-50%,-50%)}}`}</style>
    </>
  );
}
