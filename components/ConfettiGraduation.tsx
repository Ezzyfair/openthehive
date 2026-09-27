// ConfettiGraduation.tsx — fires when the bee's status flips to 'active'.
'use client';
//
// HUMAN-WINDOW-001 commit 4, fix 3. THE TRIGGER IS UNCHANGED: graduation is still
// agents.status becoming 'active'. What changed is the transport. This component used to
// hold its own anon-key Supabase client and poll `agents` every 5 s from the browser —
// the last such reader in the tree. It now takes the answer as a prop, and the caller
// gets it from a server route it is already polling, so the whole component is one
// boolean edge and a canvas.
//
// Reported honestly in the packet: on main this component was IMPORTED by
// app/honeycombs/[id]/page.tsx and never rendered, so the trigger it "had on the old
// chamber page" was no trigger at all. The trigger reproduced here is the one the
// component itself implemented.
import { useEffect, useRef, useState } from 'react';

interface Props {
  /** True once the bee's status is 'active'. The false -> true edge fires the confetti. */
  graduated: boolean;
}

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

export default function ConfettiGraduation({ graduated }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [show, setShow] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    // The EDGE, not the value: fires once when graduated first becomes true, so a view
    // that keeps polling a graduated bee does not re-fire the confetti every 5 s.
    if (!graduated || firedRef.current) return;
    firedRef.current = true;
    setShow(true);
    {
      {
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
    }
  }, [graduated]);

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
