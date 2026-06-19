import { useState } from 'react'
import { useRestaurant } from '../lib/RestaurantContext'

function StarBadge({ rating }) {
  if (rating == null) return null
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500 text-xs font-semibold">
      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.07 3.29a1 1 0 00.95.69h3.46c.97 0 1.37 1.24.59 1.81l-2.8 2.03a1 1 0 00-.36 1.12l1.07 3.29c.3.92-.76 1.69-1.54 1.12l-2.8-2.03a1 1 0 00-1.18 0l-2.8 2.03c-.78.57-1.84-.2-1.54-1.12l1.07-3.29a1 1 0 00-.36-1.12L2.64 8.72c-.78-.57-.38-1.81.59-1.81h3.46a1 1 0 00.95-.69L8.7 2.93z" /></svg>
      {Number(rating).toFixed(1)}
    </span>
  )
}

export default function RestaurantSwitcher() {
  const { restaurants, restaurant, setRestaurant } = useRestaurant()
  const [open, setOpen] = useState(false)

  if (!restaurant) return null

  const multiple = restaurants.length > 1

  const Trigger = (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-9 h-9 rounded-xl bg-lime-300 text-ocean-800 flex items-center justify-center font-bold shrink-0">
        {restaurant.name.charAt(0)}
      </div>
      <div className="min-w-0 text-left">
        <p className="font-semibold text-ocean-900 truncate leading-tight">{restaurant.name}</p>
        <p className="text-xs text-slate-400 truncate">
          {restaurant.neighborhood ? `${restaurant.neighborhood} · ` : ''}{restaurant.city || 'Madrid'}
        </p>
      </div>
    </div>
  )

  if (!multiple) {
    return <div className="py-1">{Trigger}</div>
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 py-1 pr-2 rounded-xl hover:bg-slate-100 transition-colors"
      >
        {Trigger}
        <svg className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 w-72 max-w-[85vw] bg-surface rounded-2xl shadow-soft border border-slate-100 p-1.5 z-40 max-h-[60vh] overflow-y-auto">
            <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">Mis restaurantes</p>
            {restaurants.map((r) => {
              const active = r.id === restaurant.id
              return (
                <button
                  key={r.id}
                  onClick={() => { setRestaurant(r); setOpen(false) }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-left transition-colors ${active ? 'bg-ocean-50' : 'hover:bg-slate-50'}`}
                >
                  <div className="min-w-0">
                    <p className={`text-sm truncate ${active ? 'font-semibold text-ocean-700' : 'text-slate-700'}`}>{r.name}</p>
                    <p className="text-xs text-slate-400 truncate">{r.neighborhood || r.city || 'Madrid'}</p>
                  </div>
                  <StarBadge rating={r.google_rating} />
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
