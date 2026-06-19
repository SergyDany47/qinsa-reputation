import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRestaurant } from '../lib/RestaurantContext'
import Spinner from '../components/Spinner'
import NoRestaurant from '../components/NoRestaurant'
import { Card, PageHeader, EmptyState } from '../components/ui'

const SENTIMENT = {
  positive: { color: 'text-emerald-600', ring: 'ring-emerald-100', dot: 'bg-emerald-400', label: 'Positivo' },
  negative: { color: 'text-red-500',     ring: 'ring-red-100',     dot: 'bg-red-400',     label: 'Negativo' },
  mixed:    { color: 'text-amber-500',   ring: 'ring-amber-100',   dot: 'bg-amber-400',   label: 'Mixto' },
}

const initials = (n) => n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
const AVATARS = ['bg-ocean-100 text-ocean-700', 'bg-lime-200 text-ocean-800', 'bg-sky-100 text-sky-700', 'bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700']
const avatarColor = (n) => AVATARS[n.charCodeAt(0) % AVATARS.length]

function StaffCard({ member }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = SENTIMENT[member.sentiment] || SENTIMENT.mixed
  const quotes = member.sample_quotes || []
  const visible = expanded ? quotes : quotes.slice(0, 2)

  return (
    <Card className="p-4 flex flex-col">
      <div className="flex items-center gap-3">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center font-bold ring-4 ${cfg.ring} ${avatarColor(member.name)} shrink-0`}>
          {initials(member.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-800">{member.name}</span>
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">{member.mention_count}×</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
          </div>
        </div>
      </div>

      {quotes.length > 0 && (
        <div className="mt-3 space-y-2">
          {visible.map((q, i) => (
            <p key={i} className="text-xs text-slate-500 italic border-l-2 border-slate-200 pl-2.5 leading-snug">"{q}"</p>
          ))}
          {quotes.length > 2 && (
            <button onClick={() => setExpanded(e => !e)} className={`text-xs font-semibold ${cfg.color}`}>
              {expanded ? 'Ver menos' : `+${quotes.length - 2} citas más`}
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

export default function Empleados() {
  const { restaurant, loading: loadingRestaurant } = useRestaurant()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!restaurant) { setLoading(false); return }
    setLoading(true)
    supabase.from('insights').select('staff_mentions')
      .eq('restaurant_id', restaurant.id).order('generated_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        const mentions = data?.staff_mentions || []
        setStaff([...mentions].sort((a, b) => b.mention_count - a.mention_count))
        setLoading(false)
      })
  }, [restaurant?.id])

  if (loadingRestaurant) return <div className="py-20"><Spinner /></div>
  if (!restaurant) return <NoRestaurant />

  return (
    <div>
      <PageHeader
        overline="Análisis del equipo"
        title="Menciones del equipo"
        meta={!loading && staff.length > 0 && <span>{staff.length} empleado{staff.length !== 1 ? 's' : ''} mencionado{staff.length !== 1 ? 's' : ''} por clientes</span>}
      />

      {loading ? (
        <div className="py-20"><Spinner /></div>
      ) : staff.length === 0 ? (
        <EmptyState title="Sin menciones de empleados" subtitle="No se han detectado nombres propios del personal en las reseñas analizadas." />
      ) : (
        <>
          <div className="flex items-center gap-4 mb-4">
            {Object.values(SENTIMENT).map((cfg) => (
              <div key={cfg.label} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span className="text-xs text-slate-400">{cfg.label}</span>
              </div>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
            {staff.map((m, i) => <StaffCard key={i} member={m} />)}
          </div>
        </>
      )}
    </div>
  )
}
