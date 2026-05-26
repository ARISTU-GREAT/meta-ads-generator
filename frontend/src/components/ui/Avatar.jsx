const palette = [
  'bg-indigo-500', 'bg-violet-500', 'bg-pink-500',
  'bg-sky-500',    'bg-emerald-500', 'bg-amber-500',
]

function colorFrom(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return palette[Math.abs(h) % palette.length]
}

export default function Avatar({ name = '', email = '', size = 'md', className = '' }) {
  const seed = name || email
  const letter = seed.trim()[0]?.toUpperCase() ?? '?'
  const bg = colorFrom(seed)

  const sizes = {
    sm:  'w-7 h-7 text-xs',
    md:  'w-8 h-8 text-sm',
    lg:  'w-10 h-10 text-base',
  }

  return (
    <div
      className={`
        ${sizes[size] ?? sizes.md} ${bg} ${className}
        rounded-full flex items-center justify-center
        font-semibold text-white flex-shrink-0 select-none
      `}
    >
      {letter}
    </div>
  )
}
