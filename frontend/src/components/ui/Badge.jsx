const variants = {
  active:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  paused:   'bg-amber-500/10  text-amber-400  border-amber-500/20',
  draft:    'bg-zinc-700/40   text-zinc-400   border-zinc-600/30',
  admin:    'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  platform: 'bg-zinc-800      text-zinc-300   border-zinc-700/60',
  format:   'bg-zinc-800/60   text-zinc-400   border-zinc-700/40',
}

export default function Badge({ children, variant = 'draft', className = '' }) {
  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded-md
        text-xs font-medium border
        ${variants[variant] ?? variants.draft}
        ${className}
      `}
    >
      {children}
    </span>
  )
}
