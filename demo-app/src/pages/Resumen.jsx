import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRestaurant } from '../App'
import Spinner from '../components/Spinner'
import NoRestaurant from '../components/NoRestaurant'

function ScoreRing({ score }) {
  const size = 140
  const stroke = 10
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(score, 10) / 10) * circ
  const color = score >= 8 ? '#00A86B' : score >= 6.5 ? '#16a34a' : score >= 5 ? '#f59e0b' : '#ef4444'
  const label = score >= 8.5 ? 'Excelente' : score >= 7 ? 'Muy bueno' : score >= 5.5 ? 'Bueno' : score >= 4 ? 'Regular' : 'Mejorable'

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={color} strokeWidth={stroke}
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold" style={{ color }}>{Number(score).toFixed(1)}</span>
          <span className="text-xs text-slate-400 -mt-1">/10</span>
        </div>
      </div>
      <span className="text-sm font-bold tracking-wide" style={{ color }}>{label}</span>
    </div>
  )
}

function ProblemCard({ text, index }) {
  return (
    <div className="flex gap-3 p-3.5 bg-red-50 border border-red-100 rounded-xl">
      <span className="shrink-0 w-5 h-5 bg-red-100 text-red-500 rounded-full text-xs font-bold flex items-center justify-center mt-0.5">
        {index + 1}
      </span>
      <p className="text-sm text-slate-700 leading-snug">{text}</p>
    </div>
  )
}

function StrengthCard({ text, index }) {
  return (
    <div className="flex gap-3 p-3.5 bg-emerald-50 border border-emerald-100 rounded-xl">
      <span className="shrink-0 w-5 h-5 bg-emerald-100 text-emerald-600 rounded-full text-xs font-bold flex items-center justify-center mt-0.5">
        {index + 1}
      </span>
      <p className="text-sm text-slate-700 leading-snug">{text}</p>
    </div>
  )
}

export default function Resumen() {
  const { restaurant } = useRestaurant()
  const [insights, setInsights] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!restaurant) { setLoading(false); return }
    setLoading(true)
    supabase
      .from('insights')
      .select('sentiment_score,summary,top_problems,top_strengths,response_quality')
      .eq('restaurant_id', restaurant.id)
      .single()
      .then(({ data }) => { setInsights(data); setLoading(false) })
  }, [restaurant?.id])

  if (!restaurant) return <NoRestaurant label="el resumen ejecutivo" />

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-qinsa-blue px-4 pt-10 pb-4">
        <p className="text-white/50 text-xs font-medium uppercase tracking-widest">Resumen ejecutivo</p>
        <h1 className="text-white text-lg font-bold mt-0.5 truncate">{restaurant.name}</h1>
        <div className="flex items-center gap-3 mt-1.5">
          {restaurant.google_rating && (
            <span className="text-white/70 text-xs">⭐ {Number(restaurant.google_rating).toFixed(1)}</span>
          )}
          {restaurant.review_count && (
            <span className="text-white/70 text-xs">{restaurant.review_count.toLocaleString('es-ES')} reseñas</span>
          )}
          {restaurant.response_rate != null && (
            <span className="text-white/70 text-xs">{Math.round(restaurant.response_rate)}% respondidas</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {loading ? (
          <Spinner />
        ) : !insights ? (
          <p className="text-center text-slate-400 py-12">No hay insights disponibles</p>
        ) : (
          <>
            {/* Score ring */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col items-center gap-4">
              <ScoreRing score={Number(insights.sentiment_score)} />
              {insights.summary && (
                <p className="text-sm text-slate-600 text-center leading-relaxed border-t border-slate-100 pt-4 w-full">
                  {insights.summary}
                </p>
              )}
            </div>

            {/* Problemas */}
            {insights.top_problems?.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-2 h-2 bg-red-400 rounded-full" />
                  <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Áreas de mejora</h2>
                </div>
                <div className="space-y-2">
                  {insights.top_problems.map((p, i) => <ProblemCard key={i} text={p} index={i} />)}
                </div>
              </div>
            )}

            {/* Fortalezas */}
            {insights.top_strengths?.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                  <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Puntos fuertes</h2>
                </div>
                <div className="space-y-2">
                  {insights.top_strengths.map((s, i) => <StrengthCard key={i} text={s} index={i} />)}
                </div>
              </div>
            )}

            {/* Respuesta del dueño */}
            {insights.response_quality && (
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-qinsa-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Gestión de respuestas</h2>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{insights.response_quality}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
