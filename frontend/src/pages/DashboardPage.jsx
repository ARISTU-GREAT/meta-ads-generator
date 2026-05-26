import { useAuth } from '../hooks/useAuth'
import AppLayout from '../layouts/AppLayout'

export default function DashboardPage() {
  const { user } = useAuth()

  return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4 animate-fade-in">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-accent-muted border border-accent/20 text-xs font-medium text-accent mb-2">
            Phase 1 Prototype
          </div>
          <h1 className="text-4xl font-semibold text-text-primary tracking-tight">
            AdFlow Prototype
          </h1>
          <p className="text-text-secondary text-sm">
            Signed in as <span className="text-text-primary">{user?.email}</span>
          </p>
        </div>
      </div>
    </AppLayout>
  )
}
