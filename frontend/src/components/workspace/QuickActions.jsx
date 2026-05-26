import { IconBrands, IconCampaigns, IconGenerations, IconRefresh } from '../ui/Icons'

const ACTIONS = [
  {
    label: 'Create Brand',
    description: 'Set up your brand identity, colors, and assets',
    icon: IconBrands,
    gradient: 'from-blue-500/20 to-indigo-500/10',
    iconBg: 'bg-blue-500/10 text-blue-400',
    border: 'hover:border-blue-500/30',
    glow: 'hover:shadow-blue-500/5',
  },
  {
    label: 'New Campaign',
    description: 'Start a new ad campaign from scratch',
    icon: IconCampaigns,
    gradient: 'from-violet-500/20 to-purple-500/10',
    iconBg: 'bg-violet-500/10 text-violet-400',
    border: 'hover:border-violet-500/30',
    glow: 'hover:shadow-violet-500/5',
  },
  {
    label: 'Generate Creatives',
    description: 'AI-powered ad creative generation at scale',
    icon: IconGenerations,
    gradient: 'from-indigo-500/20 to-accent/10',
    iconBg: 'bg-accent-muted text-accent',
    border: 'hover:border-accent/30',
    glow: 'hover:shadow-accent/5',
  },
  {
    label: 'Remix Existing Ad',
    description: 'Transform and remix your best performing ads',
    icon: IconRefresh,
    gradient: 'from-cyan-500/20 to-sky-500/10',
    iconBg: 'bg-cyan-500/10 text-cyan-400',
    border: 'hover:border-cyan-500/30',
    glow: 'hover:shadow-cyan-500/5',
  },
]

export default function QuickActions() {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-primary">Quick Actions</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {ACTIONS.map((action) => (
          <ActionCard key={action.label} {...action} />
        ))}
      </div>
    </section>
  )
}

function ActionCard({ label, description, icon: Icon, gradient, iconBg, border, glow }) {
  return (
    <button
      className={`
        group relative text-left w-full
        bg-bg-surface border border-border rounded-xl
        overflow-hidden
        hover:bg-bg-elevated
        hover:shadow-lg ${glow}
        ${border}
        transition-all duration-200
        focus:outline-none focus:ring-2 focus:ring-accent/30
      `}
    >
      {/* gradient top bar */}
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-200`} />

      <div className="p-5">
        <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center mb-3.5 transition-transform duration-200 group-hover:scale-110`}>
          <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
        </div>
        <p className="text-sm font-semibold text-text-primary mb-1 group-hover:text-white transition-colors">
          {label}
        </p>
        <p className="text-xs text-text-muted leading-relaxed">
          {description}
        </p>
      </div>
    </button>
  )
}
