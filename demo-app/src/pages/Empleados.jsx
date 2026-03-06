import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRestaurant } from '../App'
import Spinner from '../components/Spinner'
import NoRestaurant from '../components/NoRestaurant'

const SENTIMENT_CONFIG = {
  positive: { color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100', dot: 'bg-emerald-400', label: 'Positivo' },
  negative: { color: 'text-red-500',     bg: 'bg-red-50 border-red-100',         dot: 'bg-red-400',     label: 'Negativo' },
  mixed:    { color: 'text-amber-500',   bg: 'bg-amber-50 border-amber-100',     dot: 'bg-amber-400',   label: 'Mixto' },
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function avatarColor(name) {
  const colors = [
    'bg-violet-100 text-violet-700',
    'bg-sky-100 text-sky-700',
    'bg-rose-100 text-rose-700',
    'bg-amber-100 text-amber-700',
    'bg-teal-100 text-teal-700',
  ]
  const idx = name.charCodeAt(0) % colors.length
  return colors[idx]
}

function StaffCard({ member }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = SENTIMENT_CONFIG[member.sentiment] || SENTIMENT_CONFIG.mixed
  const quotes = member.sample_quotes || []
  const visibleQuotes = expanded ? quotes : quotes.slice(0, 2)

  return (
    <div className={`bg-white rounded-2xl shadow-sm border ${cfg.bg} overflow-hidden`}>
      <div className="p-4">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${avatarColor(member.name)}`}>
            {initials(member.name)}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-800">{member.name}</span>
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">
                {member.mention_count}x
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
            </div>
          </div>
        </div>

        {/* Quotes */}
        {quotes.length > 0 && (
          <div className="mt-3 space-y-2">
            {visibleQuotes.map((q, i) => (
              <p key={i} className="text-xs text-slate-500 italic border-l-2 border-slate-200 pl-2.5 leading-snug">
                "{q}"
              </p>
            ))}
            {quotes.length > 2 && (
              <button
                onClick={() => setExpanded(e => !e)}
                className={`text-xs font-semibold ${cfg.color} mt-1`}
              >
                {expanded ? 'Ver menos' : `+${quotes.length - 2} citas más`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Empleados() {
  const { restaurant } = useRestaurant()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!restaurant) { setLoading(false); return }
    setLoading(true)
    supabase
      .from('insights')
      .select('staff_mentions')
      .eq('restaurant_id', restaurant.id)
      .single()
      .then(({ data }) => {
        const mentions = data?.staff_mentions || []
        // Ordenar por menciones descendente
        const sorted = [...mentions].sort((a, b) => b.mention_count - a.mention_count)
        setStaff(sorted)
        setLoading(false)
      })
  }, [restaurant?.id])

  if (!restaurant) return <NoRestaurant label="las menciones del equipo" />

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-qinsa-blue px-4 pt-10 pb-4">
        <p className="text-white/50 text-xs font-medium uppercase tracking-widest">Análisis del equipo</p>
        <h1 className="text-white text-lg font-bold mt-0.5 truncate">{restaurant.name}</h1>
        {!loading && staff.length > 0 && (
          <p className="text-white/60 text-xs mt-1">
            {staff.length} empleado{staff.length !== 1 ? 's' : ''} mencionado{staff.length !== 1 ? 's' : ''} por clientes
          </p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        {loading ? (
          <Spinner />
        ) : staff.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="font-medium">Sin menciones de empleados</p>
            <p className="text-sm mt-1">No se han detectado nombres propios en las reseñas</p>
          </div>
        ) : (
          <>
            {/* Leyenda */}
            <div className="flex items-center gap-4 px-1 pb-1">
              {Object.entries(SENTIMENT_CONFIG).map(([key, cfg]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  <span className="text-xs text-slate-400">{cfg.label}</span>
                </div>
              ))}
            </div>
            {staff.map((member, i) => <StaffCard key={i} member={member} />)}
          </>
        )}
      </div>
    </div>
  )
}
