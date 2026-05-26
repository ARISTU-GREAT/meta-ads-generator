import WorkspaceLayout from '../layouts/WorkspaceLayout'
import QuickActions from '../components/workspace/QuickActions'
import RecentCampaigns from '../components/workspace/RecentCampaigns'
import ActivityFeed from '../components/workspace/ActivityFeed'
import { useAuth } from '../hooks/useAuth'

export default function WorkspacePage() {
  const { user } = useAuth()

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || 'there'

  return (
    <WorkspaceLayout title="Workspace">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-10 animate-fade-in">

        {/* greeting */}
        <div>
          <h2 className="text-2xl font-semibold text-text-primary tracking-tight">
            Good morning, {firstName} 👋
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Here&apos;s what&apos;s happening with your creative workspace.
          </p>
        </div>

        {/* stats row */}
        <StatsRow />

        {/* quick actions */}
        <QuickActions />

        {/* campaigns + activity: 2-column on large screens */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-8">
          <RecentCampaigns />
          <ActivityFeed />
        </div>

      </div>
    </WorkspaceLayout>
  )
}

const STATS = [
  { label: 'Active Campaigns',  value: '3',  change: '+1 this week' },
  { label: 'Creatives Generated', value: '47', change: '+12 this week' },
  { label: 'Brands',            value: '2',  change: null },
  { label: 'Remixes',           value: '9',  change: '+3 this week' },
]

function StatsRow() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {STATS.map(({ label, value, change }) => (
        <div
          key={label}
          className="bg-bg-surface border border-border rounded-xl px-4 py-4"
        >
          <p className="text-xs text-text-muted mb-1">{label}</p>
          <p className="text-2xl font-semibold text-text-primary tracking-tight">{value}</p>
          {change && (
            <p className="text-[11px] text-emerald-400 mt-1">{change}</p>
          )}
        </div>
      ))}
    </div>
  )
}
