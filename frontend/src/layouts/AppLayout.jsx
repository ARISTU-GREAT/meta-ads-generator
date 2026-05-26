import { useAuth } from '../hooks/useAuth'
import Logo from '../components/ui/Logo'

export default function AppLayout({ children }) {
  const { user, isAdmin, signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
  }

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      <header className="h-14 border-b border-border bg-bg-surface flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between">
          <Logo size="sm" />

          <div className="flex items-center gap-3">
            {isAdmin && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-accent-muted text-accent border border-accent/20">
                Admin
              </span>
            )}
            <span className="text-sm text-text-secondary hidden sm:block">
              {user?.email}
            </span>
            <button
              onClick={handleSignOut}
              className="text-sm text-text-muted hover:text-text-primary transition-colors duration-150 focus:outline-none"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}
