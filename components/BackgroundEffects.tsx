'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

// Generates an array of semi-random particles for a starry/dust effect
const generateParticles = (count: number) => {
  return Array.from({ length: count }).map((_, i) => ({
    id: i,
    left: [10, 18, 26, 34, 42, 51, 60, 68, 76, 84, 91, 5, 20, 35, 50, 65, 80, 95, 15, 45, 75, 85, 90, 8, 28, 48, 58, 88, 98][i % 29],
    top: [16, 72, 38, 10, 58, 24, 82, 46, 14, 66, 30, 80, 20, 60, 90, 40, 70, 50, 85, 15, 65, 35, 95, 25, 55, 45, 75, 5, 18][i % 29],
    size: (i % 3) + 1.5,
    delay: (i % 5) * 0.7,
    duration: 5 + (i % 4),
    opacity: 0.2 + ((i % 5) * 0.1),
    yOffset: (i % 2 === 0) ? -20 : 20,
    xOffset: (i % 3 === 0) ? -10 : 10,
  }));
};

const STAR_FIELD = generateParticles(30);

export function BackgroundEffects() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [pointer, setPointer] = useState({ x: 0.5, y: 0.5 });
  const [mounted, setMounted] = useState(false);
  const [trail, setTrail] = useState<{x: number, y: number, id: number}[]>([]);

  useEffect(() => {
    setMounted(true);
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;

    let frame = 0;
    const onPointerMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPointer({
          x: event.clientX / window.innerWidth,
          y: event.clientY / window.innerHeight,
        });

        // Add to trail
        setTrail(prev => {
          const newTrail = [...prev, { x: event.clientX, y: event.clientY, id: Date.now() }];
          if (newTrail.length > 20) return newTrail.slice(newTrail.length - 20);
          return newTrail;
        });
      });
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    
    // Cleanup old trail
    const interval = setInterval(() => {
      setTrail(prev => {
        if (prev.length === 0) return prev;
        return prev.slice(1);
      });
    }, 50);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      clearInterval(interval);
    };
  }, [prefersReducedMotion]);

  if (!mounted) return null;

  const driftX = (pointer.x - 0.5) * 80;
  const driftY = (pointer.y - 0.5) * 60;

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-[0] bg-background">
      <motion.div
        animate={
          prefersReducedMotion
            ? { opacity: 0.35 }
            : {
                opacity: [0.3, 0.45, 0.3],
                scale: [1, 1.06, 1],
              }
        }
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(14,116,144,0.32),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_70%_85%,rgba(59,130,246,0.16),transparent_35%)]"
      />

      {/* Deep Navy/Cyan Blur */}
      <motion.div
        animate={{
          x: [driftX, driftX + 100, driftX],
          y: [driftY, driftY - 50, driftY],
          scale: [1, 1.1, 1],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        className="absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] rounded-full mix-blend-screen filter blur-[120px] opacity-40 bg-blue-900"
      />

      {/* Ocean Blue Blur */}
      <motion.div
        animate={{
          x: [-driftX * 0.7, -driftX * 0.7 - 100, -driftX * 0.7],
          y: [driftY * 0.6, driftY * 0.6 + 100, driftY * 0.6],
          scale: [1, 1.2, 1],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        className="absolute top-[20%] -right-[20%] w-[60vw] h-[60vw] rounded-full mix-blend-screen filter blur-[140px] opacity-30 bg-[#0c4a6e]"
      />

      {/* Ambient pinkish/purple accent for cuteness */}
      <motion.div
        animate={{
          x: [driftX * 0.3, driftX * 0.3 - 50, driftX * 0.3],
          y: [-driftY * 0.4, -driftY * 0.4 - 30, -driftY * 0.4],
          scale: [1, 1.15, 1],
        }}
        transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
        className="absolute top-[40%] left-[40%] w-[50vw] h-[50vw] rounded-full mix-blend-screen filter blur-[130px] opacity-20 bg-purple-800"
      />

      {/* Deep Blue Blur */}
      <motion.div
        animate={{
          x: [driftX * 0.5, driftX * 0.5 + 50, driftX * 0.5],
          y: [-driftY * 0.8, -driftY * 0.8 + 80, -driftY * 0.8],
          scale: [1, 0.9, 1],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute -bottom-[20%] left-[20%] w-[80vw] h-[60vw] rounded-full mix-blend-screen filter blur-[150px] opacity-30 bg-[#0a2342]"
      />

      {/* White floating dots ("pallini bianchi") */}
      {STAR_FIELD.map((star) => (
        <motion.div
          key={star.id}
          className="absolute rounded-full bg-white/90 shadow-[0_0_15px_rgba(255,255,255,0.9)]"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
          }}
          animate={
            prefersReducedMotion
              ? { opacity: star.opacity }
              : {
                  opacity: [star.opacity * 0.3, star.opacity, star.opacity * 0.3],
                  scale: [1, 1.5, 1],
                  y: [0, star.yOffset, 0],
                  x: [0, star.xOffset, 0],
                }
          }
          transition={{
            duration: star.duration,
            delay: star.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Magic Cursor Trail */}
      {trail.map((t, index) => (
        <motion.div
          key={t.id}
          initial={{ opacity: 0.8, scale: Number(1 - index * 0.05) }}
          animate={{ opacity: 0, scale: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="absolute rounded-full bg-sky-300 w-2 h-2 shadow-[0_0_10px_rgba(125,211,252,0.8)] pointer-events-none z-50"
          style={{
            left: t.x - 4,
            top: t.y - 4,
          }}
        />
      ))}
    </div>
  );
}
