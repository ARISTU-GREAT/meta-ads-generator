export default function Button({ children, loading = false, variant = 'primary', className = '', ...props }) {
  if (variant === 'ghost') {
    return (
      <button className={`btn-ghost ${className}`} {...props}>
        {children}
      </button>
    )
  }

  return (
    <button className={`btn-primary ${className}`} disabled={loading || props.disabled} {...props}>
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {children}
        </span>
      ) : children}
    </button>
  )
}
