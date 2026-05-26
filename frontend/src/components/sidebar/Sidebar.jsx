import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Logo from '../ui/Logo'
import Avatar from '../ui/Avatar'
import {
  IconWorkspace, IconBrands, IconCampaigns, IconGenerations,
  IconMemory, IconSettings, IconAdmin, IconLogout, IconX,
} from '../ui/Icons'

const NAV_ITEMS = [
  { label: 'Workspace',        icon: IconWorkspace,   path: '/dashboard' },
  { label: 'Brands',           icon: IconBrands,      path: '/brands' },
  { label: 'Campaigns',        icon: IconCampaigns,   path: '/campaigns' },
  { label: 'Generations',      icon: IconGenerations, path: '/generations' },
  { label: 'Creative Memory',  icon: IconMemory,      path: '/memory' },
]

const BOTTOM_ITEMS = [
  { label: 'Settings', icon: IconSettings, path: '/settings' },
]

export default function Sidebar({ isOpen, onClose }) {
  const { user, isAdmin, signOut } = useAuth()
  const location = useLocation()

  async function handleSignOut() {
    await signOut()
  }

  function isActive(path) {
    return location.pathname === path
  }

  return (
    <>
      {/* mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30
          w-[224px] flex-shrink-0
          bg-bg-surface border-r border-border
          flex flex-col
          transition-transform duration-200 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* logo */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
          <Logo size="sm" />
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        {/* primary nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ label, icon: Icon, path }) => (
            <NavItem
              key={path}
              label={label}
              icon={<Icon className="w-[18px] h-[18px]" />}
              path={path}
              active={isActive(path)}
              onClick={onClose}
            />
          ))}

          {isAdmin && (
            <NavItem
              label="Admin"
              icon={<IconAdmin className="w-[18px] h-[18px]" />}
              path="/admin"
              active={isActive('/admin')}
              onClick={onClose}
              accent
            />
          )}
        </nav>

        {/* bottom section */}
        <div className="border-t border-border px-2 py-2 space-y-0.5">
          {BOTTOM_ITEMS.map(({ label, icon: Icon, path }) => (
            <NavItem
              key={path}
              label={label}
              icon={<Icon className="w-[18px] h-[18px]" />}
              path={path}
              active={isActive(path)}
              onClick={onClose}
            />
          ))}
        </div>

        {/* user profile */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5 group">
            <Avatar name={user?.user_metadata?.full_name} email={user?.email} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-text-primary truncate leading-tight">
                {user?.user_metadata?.full_name || 'User'}
              </p>
              <p className="text-[11px] text-text-muted truncate leading-tight mt-0.5">
                {user?.email}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              className="flex-shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors opacity-0 group-hover:opacity-100"
              title="Sign out"
            >
              <IconLogout className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

function NavItem({ label, icon, path, active, onClick, accent = false }) {
  return (
    <Link
      to={path}
      onClick={onClick}
      className={`
        flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium
        transition-colors duration-150 group
        ${active
          ? 'bg-bg-elevated text-text-primary'
          : accent
            ? 'text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-300'
            : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
        }
      `}
    >
      <span className={`flex-shrink-0 ${active ? 'text-text-primary' : ''}`}>
        {icon}
      </span>
      {label}
      {active && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
      )}
    </Link>
  )
}
