// Primitivas de UI compartidas por las páginas del cliente.

export function Card({ className = '', children }) {
  return (
    <div className={`bg-surface rounded-2xl border border-slate-100 shadow-card ${className}`}>
      {children}
    </div>
  )
}

export function SectionLabel({ children, dot = 'bg-ocean-400', icon = null }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon || <span className={`w-2 h-2 rounded-full ${dot}`} />}
      <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">{children}</h2>
    </div>
  )
}

export function PageHeader({ overline, title, meta }) {
  return (
    <div className="mb-6">
      {overline && (
        <p className="text-xs font-semibold uppercase tracking-widest text-ocean-400">{overline}</p>
      )}
      <h1 className="text-2xl lg:text-3xl font-bold text-ocean-900 tracking-tight mt-0.5">{title}</h1>
      {meta && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-slate-500">{meta}</div>}
    </div>
  )
}

export function EmptyState({ title, subtitle, icon = null }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && <div className="w-14 h-14 rounded-2xl bg-ocean-50 text-ocean-500 flex items-center justify-center mb-4">{icon}</div>}
      <p className="font-semibold text-slate-700">{title}</p>
      {subtitle && <p className="text-sm text-slate-400 mt-1 max-w-sm">{subtitle}</p>}
    </div>
  )
}
