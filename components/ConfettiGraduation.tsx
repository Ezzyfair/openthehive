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
  /** The chamber id. The confetti fires once for it, on the first open after graduation. */
  onceKey?: string | null;
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

/** MEMBER-001 R5 — true once per chamber, in this browser. Unreadable storage is a no. */
function firstOpen(onceKey: string): boolean {
  const key = `hive_graduation_confetti:${onceKey}`;
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

export default function ConfettiGraduation({ graduated, onceKey }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [show, setShow] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    // The EDGE, not the value: decided once when graduated first becomes true, so a view
    // that keeps polling a graduated bee does not re-fire the confetti every 5 s.
    if (!graduated || !onceKey || firedRef.current) return;
    firedRef.current = true;
    if (firstOpen(onceKey)) setShow(true);
  }, [graduated, onceKey]);

  // Its own effect, after the render that mounts the canvas. MEMBER-001 R5: this used to
  // run beside setShow(true), found no canvas, and returned, so nothing ever painted.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!show || !canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Three waves 3s apart, then gone.
    fireWave(canvas);
    const timers = [
      setTimeout(() => fireWave(canvas), 3000),
      setTimeout(() => fireWave(canvas), 6000),
      setTimeout(() => setShow(false), 8000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [show]);

  if (!show) return null;
  // MEMBER-001 item 7 — the confetti only. The GRADUATED words used to be a fixed
  // overlay here, painted over the chamber's text on every open. They now sit in their
  // own band under the chamber title (app/member/MemberChat.tsx).
  return (
    <>
      <canvas ref={canvasRef}
        style={{ position:'fixed', inset:0, width:'100vw', height:'100vh',
          pointerEvents:'none', zIndex:9999 }} />
    </>
  );
}
