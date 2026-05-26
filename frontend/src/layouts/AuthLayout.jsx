import Logo from '../components/ui/Logo'

export default function AuthLayout({ children }) {
  return (
    <div className="min-h-screen bg-bg-base flex flex-col items-center justify-center px-4 py-12 animate-fade-in">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>
        {children}
      </div>
      <p className="mt-8 text-xs text-text-muted">
        © {new Date().getFullYear()} AdFlow. All rights reserved.
      </p>
    </div>
  )
}
