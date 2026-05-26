import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import Sidebar from '../components/sidebar/Sidebar'
import Avatar from '../components/ui/Avatar'
import Badge from '../components/ui/Badge'
import { IconMenu, IconSearch } from '../components/ui/Icons'

export default function WorkspaceLayout({ children, title = 'Workspace' }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-bg-base">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={title} onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}

function Topbar({ title, onMenuClick }) {
  const { user, isAdmin } = useAuth()

  return (
    <header className="h-14 flex-shrink-0 border-b border-border bg-bg-surface flex items-center px-4 gap-3">
      {/* mobile menu button */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors flex-shrink-0"
      >
        <IconMenu className="w-5 h-5" />
      </button>

      {/* title */}
      <h1 className="text-sm font-semibold text-text-primary flex-shrink-0">{title}</h1>

      {/* search */}
      <div className="flex-1 max-w-sm ml-4 hidden sm:flex">
        <div className="relative w-full">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          <input
            type="search"
            placeholder="Search campaigns, brands…"
            className="
              w-full bg-bg-elevated border border-border rounded-lg
              pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder-text-muted
              focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30
              transition-colors duration-150
            "
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        {isAdmin && (
          <Badge variant="admin">Admin</Badge>
        )}
        <Avatar
          name={user?.user_metadata?.full_name}
          email={user?.email}
          size="sm"
        />
      </div>
    </header>
  )
}
