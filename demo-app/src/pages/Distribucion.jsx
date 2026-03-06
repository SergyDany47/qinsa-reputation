import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRestaurant } from '../App'
import Spinner from '../components/Spinner'
import NoRestaurant from '../components/NoRestaurant'

const STAR_COLOR = {
  5: { bar: 'bg-emerald-400', text: 'text-emerald-600' },
  4: { bar: 'bg-green-400',   text: 'text-green-600' },
  3: { bar: 'bg-amber-400',   text: 'text-amber-600' },
  2: { bar: 'bg-orange-400',  text: 'text-orange-600' },
  1: { bar: 'bg-red-400',     text: 'text-red-600' },
}

function DistributionBar({ stars, count, total, maxCount }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0
  const { bar, text } = STAR_COLOR[stars]

  return (
    <div className="flex items-center gap-3">
      {/* Stars label */}
      <div className="flex items-center gap-1 w-12 shrink-0">
        <span className="text-sm font-bold text-slate-600">{stars}</span>
        <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      </div>

      {/* Bar */}
      <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${bar}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      {/* Count + pct */}
      <div className="w-14 shrink-0 text-right">
        <span className={`text-sm font-bold ${text}`}>{count}</span>
        <span className="text-xs text-slate-400 ml-1">{pct}%</span>
      </div>
    </div>
  )
}

function StatBubble({ label, value, sub }) {
  return (
    <div className="flex-1 bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col items-center gap-1">
      <span className="text-2xl font-bold text-qinsa-blue">{value}</span>
      {sub && <span className="text-xs text-slate-400">{sub}</span>}
      <span className="text-xs text-slate-500 font-medium text-center leading-tight">{label}</span>
    </div>
  )
}

export default function Distribucion() {
  const { restaurant } = useRestaurant()
  const [dist, setDist] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!restaurant) { setLoading(false); return }
    setLoading(true)
    supabase
      .from('insights')
      .select('rating_distribution,sentiment_score')
      .eq('restaurant_id', restaurant.id)
      .single()
      .then(({ data }) => {
        setDist(data)
        setLoading(false)
      })
  }, [restaurant?.id])

  if (!restaurant) return <NoRestaurant label="la distribución de ratings" />

  const distribution = dist?.rating_distribution || {}
  const total = Object.values(distribution).reduce((a, b) => a + b, 0)
  const maxCount = Math.max(...Object.values(distribution).map(Number), 1)

  // Estadísticas derivadas
  const positives = (distribution['5'] || 0) + (distribution['4'] || 0)
  const negatives = (distribution['1'] || 0) + (distribution['2'] || 0)
  const positivePct = total > 0 ? Math.round((positives / total) * 100) : 0
  const negativePct = total > 0 ? Math.round((negatives / total) * 100) : 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-qinsa-blue px-4 pt-10 pb-4">
        <p className="text-white/50 text-xs font-medium uppercase tracking-widest">Distribución de ratings</p>
        <h1 className="text-white text-lg font-bold mt-0.5 truncate">{restaurant.name}</h1>
        {!loading && total > 0 && (
          <p className="text-white/60 text-xs mt-1">{total} reseñas analizadas</p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {loading ? (
          <Spinner />
        ) : total === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="font-medium">Sin datos de distribución</p>
          </div>
        ) : (
          <>
            {/* KPI bubbles */}
            <div className="flex gap-3">
              <StatBubble
                value={restaurant.google_rating ? Number(restaurant.google_rating).toFixed(1) : '—'}
                sub="/ 5.0"
                label="Rating Google"
              />
              <StatBubble
                value={`${positivePct}%`}
                label="Reseñas positivas (4-5★)"
              />
              <StatBubble
                value={`${negativePct}%`}
                label="Reseñas negativas (1-2★)"
              />
            </div>

            {/* Bars */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 bg-qinsa-green rounded-full" />
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Desglose por estrellas</h2>
              </div>
              <div className="space-y-3">
                {[5, 4, 3, 2, 1].map(stars => (
                  <DistributionBar
                    key={stars}
                    stars={stars}
                    count={distribution[String(stars)] || 0}
                    total={total}
                    maxCount={maxCount}
                  />
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between text-xs text-slate-400">
                <span>Total analizado: {total} reseñas</span>
                <span>Fuente: Google Maps</span>
              </div>
            </div>

            {/* Sentiment score */}
            {dist?.sentiment_score && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-full border-4 border-qinsa-green flex items-center justify-center shrink-0">
                  <span className="text-lg font-bold text-qinsa-green">{Number(dist.sentiment_score).toFixed(1)}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Índice de satisfacción IA</p>
                  <p className="text-xs text-slate-400 mt-0.5">Calculado por análisis semántico de Gemini sobre {total} reseñas</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
