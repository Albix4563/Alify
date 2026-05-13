'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

const STAR_FIELD = [
  { left: 10, top: 16, size: 2, delay: 0, duration: 5.5, opacity: 0.35 },
  { left: 18, top: 72, size: 1.5, delay: 0.8, duration: 6.2, opacity: 0.4 },
  { left: 26, top: 38, size: 2.5, delay: 1.1, duration: 7.3, opacity: 0.45 },
  { left: 34, top: 10, size: 1.5, delay: 0.3, duration: 5.8, opacity: 0.3 },
  { left: 42, top: 58, size: 2, delay: 2, duration: 7, opacity: 0.45 },
  { left: 51, top: 24, size: 1.5, delay: 1.4, duration: 6.1, opacity: 0.4 },
  { left: 60, top: 82, size: 2, delay: 2.6, duration: 7.6, opacity: 0.32 },
  { left: 68, top: 46, size: 2.5, delay: 0.5, duration: 6.5, opacity: 0.4 },
  { left: 76, top: 14, size: 1.5, delay: 1.9, duration: 5.9, opacity: 0.38 },
  { left: 84, top: 66, size: 2, delay: 0.2, duration: 7.2, opacity: 0.42 },
  { left: 91, top: 30, size: 1.5, delay: 1.6, duration: 6.4, opacity: 0.35 },
];

export function BackgroundEffects() {
  const prefersReducedMotion = useReducedMotion();
  const [pointer, setPointer] = useState({ x: 0.5, y: 0.5 });

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
      });
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [prefersReducedMotion]);

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

      {STAR_FIELD.map((star, index) => (
        <motion.div
          key={index}
          className="absolute rounded-full bg-sky-200/80 shadow-[0_0_12px_rgba(125,211,252,0.8)]"
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
                  opacity: [star.opacity * 0.6, star.opacity, star.opacity * 0.6],
                  scale: [1, 1.35, 1],
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
    </div>
  );
}
