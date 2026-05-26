export default function Logo({ size = 'md' }) {
  const sizes = {
    sm: { icon: 'w-6 h-6 text-xs', text: 'text-base' },
    md: { icon: 'w-8 h-8 text-sm', text: 'text-xl' },
    lg: { icon: 'w-10 h-10 text-base', text: 'text-2xl' },
  }
  const s = sizes[size]

  return (
    <div className="flex items-center gap-2.5">
      <div className={`${s.icon} bg-accent rounded-lg flex items-center justify-center font-bold text-white flex-shrink-0`}>
        A
      </div>
      <span className={`${s.text} font-semibold text-text-primary tracking-tight`}>AdFlow</span>
    </div>
  )
}
