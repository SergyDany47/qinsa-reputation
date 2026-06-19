import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRestaurant } from '../lib/RestaurantContext'
import Spinner from '../components/Spinner'
import NoRestaurant from '../components/NoRestaurant'
import { Card, SectionLabel, PageHeader, EmptyState } from '../components/ui'

function Star({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor"><path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.07 3.29a1 1 0 00.95.69h3.46c.97 0 1.37 1.24.59 1.81l-2.8 2.03a1 1 0 00-.36 1.12l1.07 3.29c.3.92-.76 1.69-1.54 1.12l-2.8-2.03a1 1 0 00-1.18 0l-2.8 2.03c-.78.57-1.84-.2-1.54-1.12l1.07-3.29a1 1 0 00-.36-1.12L2.64 8.72c-.78-.57-.38-1.81.59-1.81h3.46a1 1 0 00.95-.69L8.7 2.93z" /></svg>
  )
}

function scoreMeta(score) {
  if (score >= 8.5) return { color: '#059669', label: 'Excelente' }
  if (score >= 7)   return { color: '#16a34a', label: 'Muy bueno' }
  if (score >= 5.5) return { color: '#f59e0b', label: 'Bueno' }
  if (score >= 4)   return { color: '#f97316', label: 'Regular' }
  return { color: '#ef4444', label: 'Mejorable' }
}

function ScoreRing({ score }) {
  const size = 132, stroke = 9
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(score, 10) / 10) * circ
  const { color, label } = scoreMeta(score)
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--ocean-100))" strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold" style={{ color }}>{Number(score).toFixed(1)}</span>
          <span className="text-xs text-slate-400 -mt-1">/ 10</span>
        </div>
      </div>
      <span className="text-sm font-bold tracking-wide" style={{ color }}>{label}</span>
    </div>
  )
}

function StatCard({ value, label, sub, accent = 'text-ocean-700' }) {
  return (
    <Card className="p-4 lg:p-5">
      <div className="flex items-baseline gap-1">
        <span className={`text-2xl lg:text-3xl font-bold ${accent}`}>{value}</span>
        {sub && <span className="text-xs text-slate-400">{sub}</span>}
      </div>
      <p className="text-xs lg:text-sm text-slate-500 mt-1 leading-tight">{label}</p>
    </Card>
  )
}

const BAR = { 5: 'bg-emerald-400', 4: 'bg-green-400', 3: 'bg-amber-400', 2: 'bg-orange-400', 1: 'bg-red-400' }

function DistRow({ stars, count, total, max }) {
  const pct = total ? Math.round((count / total) * 100) : 0
  const w = max ? (count / max) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1 w-9 shrink-0">
        <span className="text-sm font-bold text-slate-600">{stars}</span>
        <Star className="w-3.5 h-3.5 text-amber-400" />
      </div>
      <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${BAR[stars]}`} style={{ width: `${w}%`, transition: 'width .7s ease' }} />
      </div>
      <div className="w-12 shrink-0 text-right text-sm">
        <span className="font-bold text-slate-700">{count}</span>
        <span className="text-slate-400 ml-1 text-xs">{pct}%</span>
      </div>
    </div>
  )
}

function ListItem({ text, index, variant }) {
  const badge = variant === 'strength' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
  const box = variant === 'strength' ? 'bg-emerald-50/70 border-emerald-100' : 'bg-red-50/70 border-red-100'
  return (
    <div className={`flex gap-3 p-3.5 rounded-xl border ${box}`}>
      <span className={`shrink-0 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center mt-0.5 ${badge}`}>{index + 1}</span>
      <p className="text-sm text-slate-700 leading-snug">{text}</p>
    </div>
  )
}

function RecentReview({ review }) {
  return (
    <Card className="p-4">
      <div className="flex justify-between items-start gap-2 mb-1.5">
        <span className="font-semibold text-sm text-slate-800 truncate">{review.author_name}</span>
        <div className="flex gap-0.5 shrink-0">
          {[1, 2, 3, 4, 5].map(s => <Star key={s} className={`w-3 h-3 ${s <= review.rating ? 'text-amber-400' : 'text-slate-200'}`} />)}
        </div>
      </div>
      <p className="text-sm text-slate-600 line-clamp-3">{review.text}</p>
    </Card>
  )
}

export default function Resumen() {
  const { restaurant, loading: loadingRestaurant } = useRestaurant()
  const [insights, setInsights] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!restaurant) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      supabase.from('insights')
        .select('sentiment_score,summary,top_problems,top_strengths,response_quality,keywords,rating_distribution')
        .eq('restaurant_id', restaurant.id).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('reviews')
        .select('id,rating,text,author_name,review_date')
        .eq('restaurant_id', restaurant.id).not('text', 'is', null).not('text', 'eq', '')
        .order('review_date', { ascending: false }).limit(3),
    ]).then(([ins, rev]) => {
      setInsights(ins.data)
      setRecent(rev.data || [])
      setLoading(false)
    })
  }, [restaurant?.id])

  if (loadingRestaurant) return <div className="py-20"><Spinner /></div>
  if (!restaurant) return <NoRestaurant />
  if (loading) return <div className="py-20"><Spinner /></div>
  if (!insights) return <EmptyState title="Aún no hay análisis" subtitle="Cuando se ingesten reseñas, aquí verás el resumen ejecutivo del local." />

  const dist = insights.rating_distribution || {}
  const total = Object.values(dist).reduce((a, b) => a + Number(b), 0)
  const max = Math.max(...Object.values(dist).map(Number), 1)
  const positives = (Number(dist['5']) || 0) + (Number(dist['4']) || 0)
  const positivePct = total ? Math.round((positives / total) * 100) : 0

  return (
    <div>
      <PageHeader overline="Resumen ejecutivo" title={restaurant.name} meta={
        <>
          {restaurant.google_rating != null && <span className="inline-flex items-center gap-1"><Star className="w-4 h-4 text-amber-400" />{Number(restaurant.google_rating).toFixed(1)} en Google</span>}
          {restaurant.review_count != null && <span>{restaurant.review_count.toLocaleString('es-ES')} reseñas</span>}
          {restaurant.response_rate != null && <span>{Math.round(restaurant.response_rate)}% respondidas</span>}
        </>
      } />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
        <StatCard value={Number(insights.sentiment_score).toFixed(1)} sub="/10" label="Satisfacción IA" accent="text-emerald-600" />
        <StatCard value={total || '—'} label="Reseñas analizadas" />
        <StatCard value={`${positivePct}%`} label="Positivas (4-5★)" accent="text-emerald-600" />
        <StatCard value={restaurant.google_rating != null ? Number(restaurant.google_rating).toFixed(1) : '—'} sub="/5" label="Rating Google" accent="text-amber-500" />
      </div>

      {/* Hero: score + resumen */}
      <Card className="p-5 lg:p-7 mb-6">
        <div className="flex flex-col sm:flex-row items-center gap-6 lg:gap-8">
          <div className="shrink-0"><ScoreRing score={Number(insights.sentiment_score)} /></div>
          {insights.summary && (
            <p className="text-[15px] text-slate-600 leading-relaxed text-center sm:text-left">{insights.summary}</p>
          )}
        </div>
      </Card>

      {/* Fortalezas / Mejora */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {insights.top_strengths?.length > 0 && (
          <div>
            <SectionLabel dot="bg-emerald-400">Puntos fuertes</SectionLabel>
            <div className="space-y-2">{insights.top_strengths.map((s, i) => <ListItem key={i} text={s} index={i} variant="strength" />)}</div>
          </div>
        )}
        {insights.top_problems?.length > 0 && (
          <div>
            <SectionLabel dot="bg-red-400">Áreas de mejora</SectionLabel>
            <div className="space-y-2">{insights.top_problems.map((p, i) => <ListItem key={i} text={p} index={i} variant="problem" />)}</div>
          </div>
        )}
      </div>

      {/* Distribución + Palabras clave / Respuestas */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {total > 0 && (
          <Card className="p-5">
            <SectionLabel dot="bg-ocean-500">Distribución por estrellas</SectionLabel>
            <div className="space-y-3">
              {[5, 4, 3, 2, 1].map(s => <DistRow key={s} stars={s} count={Number(dist[String(s)]) || 0} total={total} max={max} />)}
            </div>
            <p className="text-xs text-slate-400 mt-4 pt-4 border-t border-slate-100">Total analizado: {total} reseñas · Fuente: Google Maps</p>
          </Card>
        )}

        <div className="space-y-6">
          {insights.keywords?.length > 0 && (
            <div>
              <SectionLabel dot="bg-lime-500">Palabras clave</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {insights.keywords.map((kw, i) => (
                  <span key={i} className="px-3 py-1.5 bg-lime-200 text-ocean-800 rounded-lg text-sm font-semibold">#{kw}</span>
                ))}
              </div>
            </div>
          )}
          {insights.response_quality && (
            <Card className="p-5">
              <SectionLabel dot="bg-ocean-400">Gestión de respuestas</SectionLabel>
              <p className="text-sm text-slate-600 leading-relaxed">{insights.response_quality}</p>
            </Card>
          )}
        </div>
      </div>

      {/* Actividad reciente */}
      {recent.length > 0 && (
        <div>
          <SectionLabel dot="bg-slate-400">Actividad reciente</SectionLabel>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recent.map(r => <RecentReview key={r.id} review={r} />)}
          </div>
        </div>
      )}
    </div>
  )
}
