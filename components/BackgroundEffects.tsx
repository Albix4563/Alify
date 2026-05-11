'use client';

import { motion } from 'motion/react';

export function BackgroundEffects() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-[0] bg-background">
      {/* Deep Navy/Cyan Blur */}
      <motion.div 
        animate={{ 
          x: [0, 100, 0],
          y: [0, -50, 0],
          scale: [1, 1.1, 1]
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        className="absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] rounded-full mix-blend-screen filter blur-[120px] opacity-40 bg-blue-900" 
      />
      
      {/* Ocean Blue Blur */}
      <motion.div 
        animate={{ 
          x: [0, -100, 0],
          y: [0, 100, 0],
          scale: [1, 1.2, 1]
        }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        className="absolute top-[20%] -right-[20%] w-[60vw] h-[60vw] rounded-full mix-blend-screen filter blur-[140px] opacity-30 bg-[#0c4a6e]" 
      />

      {/* Deep Blue Blur */}
      <motion.div 
        animate={{ 
          x: [0, 50, 0],
          y: [0, 80, 0],
          scale: [1, 0.9, 1]
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute -bottom-[20%] left-[20%] w-[80vw] h-[60vw] rounded-full mix-blend-screen filter blur-[150px] opacity-30 bg-[#0a2342]" 
      />
    </div>
  );
}
