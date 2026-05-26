import { IconGenerations, IconRefresh, IconCheck, IconImage, IconPlus } from '../ui/Icons'

const ACTIVITIES = [
  {
    id: 1,
    icon: IconGenerations,
    iconBg: 'bg-indigo-500/10 text-indigo-400',
    text: 'Generated 5 creatives',
    sub: 'Summer Skincare · Instagram 9:16',
    time: '2 hours ago',
  },
  {
    id: 2,
    icon: IconRefresh,
    iconBg: 'bg-violet-500/10 text-violet-400',
    text: 'Remixed skincare campaign ad',
    sub: 'Holiday Sale · Facebook 1:1',
    time: '5 hours ago',
  },
  {
    id: 3,
    icon: IconCheck,
    iconBg: 'bg-emerald-500/10 text-emerald-400',
    text: 'Approved 3 ad variations',
    sub: 'Summer Skincare · All formats',
    time: 'Yesterday',
  },
  {
    id: 4,
    icon: IconImage,
    iconBg: 'bg-sky-500/10 text-sky-400',
    text: 'Added new product images',
    sub: 'Brand Kit · Skincare Co.',
    time: 'Yesterday',
  },
  {
    id: 5,
    icon: IconPlus,
    iconBg: 'bg-pink-500/10 text-pink-400',
    text: 'New campaign created',
    sub: 'Holiday Sale 2025',
    time: '2 days ago',
  },
]

export default function ActivityFeed() {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-primary">Generation Activity</h2>
        <button className="text-xs text-text-muted hover:text-text-secondary transition-colors">
          Clear all
        </button>
      </div>

      <div className="bg-bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {ACTIVITIES.map((item, i) => (
          <ActivityItem key={item.id} item={item} last={i === ACTIVITIES.length - 1} />
        ))}
      </div>
    </section>
  )
}

function ActivityItem({ item }) {
  const { icon: Icon, iconBg, text, sub, time } = item

  return (
    <div className="flex items-start gap-3.5 px-4 py-3.5 hover:bg-bg-elevated/50 transition-colors group">
      <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <Icon className="w-[15px] h-[15px]" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary font-medium leading-snug">{text}</p>
        <p className="text-xs text-text-muted mt-0.5">{sub}</p>
      </div>

      <span className="text-[11px] text-text-muted flex-shrink-0 mt-0.5 tabular-nums">{time}</span>
    </div>
  )
}
