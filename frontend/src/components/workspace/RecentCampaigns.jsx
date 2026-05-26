import Card from '../ui/Card'
import Badge from '../ui/Badge'
import { IconChevronRight, IconImage } from '../ui/Icons'

const CAMPAIGNS = [
  {
    id: 1,
    name: 'Summer Skincare Launch',
    platform: 'Instagram',
    formats: ['1:1', '9:16'],
    status: 'active',
    updated: '2 hours ago',
    count: 12,
  },
  {
    id: 2,
    name: 'Holiday Sale 2025',
    platform: 'Facebook',
    formats: ['1:1', '4:5'],
    status: 'paused',
    updated: '1 day ago',
    count: 8,
  },
  {
    id: 3,
    name: 'Brand Awareness Q1',
    platform: 'TikTok',
    formats: ['9:16'],
    status: 'draft',
    updated: '3 days ago',
    count: 0,
  },
  {
    id: 4,
    name: 'Product Launch Series',
    platform: 'Multi-platform',
    formats: ['1:1', '9:16', '4:5'],
    status: 'active',
    updated: '5 days ago',
    count: 24,
  },
]

const platformColors = {
  Instagram:      'bg-pink-500/10     text-pink-400      border-pink-500/20',
  Facebook:       'bg-blue-500/10     text-blue-400      border-blue-500/20',
  TikTok:         'bg-zinc-700/40     text-zinc-300      border-zinc-600/30',
  'Multi-platform': 'bg-violet-500/10 text-violet-400    border-violet-500/20',
}

export default function RecentCampaigns() {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-primary">Recent Campaigns</h2>
        <button className="text-xs text-text-muted hover:text-text-secondary transition-colors flex items-center gap-1">
          View all <IconChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CAMPAIGNS.map((c) => (
          <CampaignCard key={c.id} campaign={c} />
        ))}
      </div>

      {/* empty state example (hidden, shown here for reference) */}
      {false && <EmptyState />}
    </section>
  )
}

function CampaignCard({ campaign }) {
  const { name, platform, formats, status, updated, count } = campaign

  return (
    <Card hover className="p-4 flex gap-4">
      {/* thumbnail placeholder */}
      <div className="w-14 h-14 rounded-lg bg-bg-elevated border border-border flex items-center justify-center flex-shrink-0 group-hover:border-zinc-600 transition-colors">
        <IconImage className="w-5 h-5 text-text-muted" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p className="text-sm font-medium text-text-primary truncate">{name}</p>
          <Badge variant={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border ${platformColors[platform] ?? 'bg-zinc-700 text-zinc-300 border-zinc-600'}`}>
            {platform}
          </span>
          {formats.map((f) => (
            <Badge key={f} variant="format">{f}</Badge>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-muted">Updated {updated}</span>
          {count > 0 && (
            <span className="text-[11px] text-text-muted">{count} creatives</span>
          )}
        </div>
      </div>
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="border border-dashed border-border rounded-xl p-10 text-center">
      <div className="w-10 h-10 rounded-lg bg-bg-elevated border border-border flex items-center justify-center mx-auto mb-3">
        <IconImage className="w-5 h-5 text-text-muted" />
      </div>
      <p className="text-sm font-medium text-text-secondary mb-1">No campaigns yet</p>
      <p className="text-xs text-text-muted">Create your first campaign to get started.</p>
    </div>
  )
}
