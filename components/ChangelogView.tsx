'use client';

import { motion } from 'motion/react';
import { History, LayoutList, ChevronDown } from 'lucide-react';
import changelogData from '@/lib/changelog.json';

export function ChangelogView() {
  const changelog = changelogData;

  return (
    <section className="relative z-0 max-w-4xl mx-auto px-4 py-8">
       <div className="flex items-center gap-4 mb-8">
           <div className="w-16 h-16 bg-blue-500/20 backdrop-blur-xl border border-blue-400/30 rounded-2xl flex items-center justify-center flex-shrink-0">
               <History className="w-8 h-8 text-sky-400" />
           </div>
           <div>
               <h1 className="text-3xl md:text-5xl font-bold text-white drop-shadow-md"> Change Log </h1>
               <p className="text-sm md:text-base text-blue-200/60 font-medium mt-1"> Tutte le novità e i miglioramenti di Albify. </p>
           </div>
       </div>

       <div className="space-y-6">
           {changelog.length > 0 ? (
               changelog.map((entry, index) => (
                   <motion.div 
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="bg-white/5 backdrop-blur-md border border-white/10 rounded-[20px] p-6 shadow-xl relative overflow-hidden"
                   >
                       <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-sky-400 to-blue-500 rounded-l-[20px]"></div>
                       <div className="flex items-center justify-between mb-4 pl-4">
                           <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight"> V {entry.version} </h2>
                           <span className="text-xs md:text-sm font-bold tracking-wider text-blue-200/50 bg-black/40 px-3 py-1 rounded-full border border-white/5">{entry.date}</span>
                       </div>
                       <ul className="space-y-3 pl-4">
                           {entry.changes.map((change: string, idx: number) => (
                               <li key={idx} className="flex items-start text-blue-100/80 text-sm md:text-base leading-relaxed">
                                   <span className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-2 mr-3 flex-shrink-0 shadow-[0_0_8px_rgba(56,189,248,0.8)]"></span>
                                   <span>{change}</span>
                               </li>
                           ))}
                       </ul>
                   </motion.div>
               ))
           ) : (
               <div className="text-center py-12 text-white/50">Caricamento change log...</div>
           )}
       </div>
    </section>
  );
}
