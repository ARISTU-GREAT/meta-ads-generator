export default function Card({ children, className = '', hover = false, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`
        bg-bg-surface border border-border rounded-xl
        ${hover ? 'hover:border-zinc-600 hover:bg-bg-elevated transition-all duration-200 cursor-pointer group' : ''}
        ${onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  )
}
