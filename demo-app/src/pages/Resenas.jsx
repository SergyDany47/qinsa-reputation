import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useRestaurant } from '../App'
import Spinner from '../components/Spinner'
import NoRestaurant from '../components/NoRestaurant'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const RATING_COLOR = {
  5: 'bg-emerald-100 text-emerald-700',
  4: 'bg-green-100 text-green-700',
  3: 'bg-amber-100 text-amber-700',
  2: 'bg-orange-100 text-orange-700',
  1: 'bg-red-100 text-red-700',
}

function Stars({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} className={`w-3.5 h-3.5 ${i <= rating ? 'text-amber-400' : 'text-slate-200'}`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(dateStr))
}

function ReviewCard({ review }) {
  const { restaurant }                      = useRestaurant()
  const [expanded, setExpanded]             = useState(false)
  const [suggestedReply, setSuggestedReply] = useState(review.suggested_reply || null)
  const [generating, setGenerating]         = useState(false)
  const [genError, setGenError]             = useState(false)

  const text   = review.text || ''
  const isLong = text.length > 200
  const displayText = !isLong || expanded ? text : text.slice(0, 200) + '…'
  const rating = review.rating || 0

  const generateReply = async () => {
    if (generating || !restaurant) return
    setGenerating(true)
    setGenError(false)
    try {
      const res = await fetch(`${API_URL}/generate-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_id: review.id, restaurant_id: restaurant.id }),
      })
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      setSuggestedReply(data.suggested_reply)
    } catch {
      setGenError(true)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-700 truncate">
            {review.author_name || 'Anónimo'}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <Stars rating={rating} />
            {review.review_date && (
              <span className="text-xs text-slate-400">{formatDate(review.review_date)}</span>
            )}
          </div>
        </div>
        <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-lg ${RATING_COLOR[rating] || 'bg-slate-100 text-slate-500'}`}>
          {rating}★
        </span>
      </div>

      {/* Review text */}
      {text ? (
        <>
          <p className="text-sm text-slate-600 leading-relaxed">{displayText}</p>
          {isLong && (
            <button onClick={() => setExpanded(e => !e)} className="text-xs text-qinsa-blue font-semibold mt-1">
              {expanded ? 'Ver menos' : 'Ver más'}
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-slate-400 italic">Sin texto</p>
      )}

      {/* Owner reply */}
      {review.owner_replied && review.reply_text && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 mb-1.5">
            <svg className="w-3.5 h-3.5 text-qinsa-green shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-xs text-qinsa-green font-semibold">Respuesta del propietario</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed pl-5">{review.reply_text}</p>
        </div>
      )}

      {/* AI suggested reply (local state — se actualiza sin recargar) */}
      {suggestedReply ? (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 mb-1.5">
            <svg className="w-3.5 h-3.5 text-qinsa-blue shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            <span className="text-xs text-qinsa-blue font-bold">Sugerencia IA</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed pl-5 italic">{suggestedReply}</p>
        </div>
      ) : text ? (
        <div className="mt-3 pt-2">
          <button
            onClick={generateReply}
            disabled={generating}
            className="flex items-center gap-1.5 text-xs text-qinsa-blue font-semibold disabled:opacity-50"
          >
            {generating ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Generando…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                Generar respuesta IA
              </>
            )}
          </button>
          {genError && <p className="text-xs text-red-400 mt-1">Error al generar — inténtalo de nuevo</p>}
        </div>
      ) : null}
    </div>
  )
}

// Barra de progreso compacta para el refresh
function RefreshProgress({ steps }) {
  const labels = ['Scraping', 'Generando', 'Guardando']
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-4 py-3">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Actualizando…</p>
      <div className="flex gap-2">
        {labels.map((label, i) => {
          const s = steps[i]?.status || 'pending'
          return (
            <div key={i} className="flex-1">
              <div className={`h-1.5 rounded-full mb-1 transition-all duration-500 ${
                s === 'done'    ? 'bg-qinsa-green' :
                s === 'running' ? 'bg-qinsa-blue animate-pulse' :
                s === 'error'   ? 'bg-red-400' :
                'bg-slate-200'
              }`} />
              <p className={`text-[10px] font-medium text-center ${
                s === 'done'    ? 'text-qinsa-green' :
                s === 'running' ? 'text-qinsa-blue' :
                'text-slate-400'
              }`}>{label}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const initialSteps = () => [
  { status: 'pending' },
  { status: 'pending' },
  { status: 'pending' },
]

export default function Resenas() {
  const { restaurant }                    = useRestaurant()
  const [reviews, setReviews]             = useState([])
  const [loading, setLoading]             = useState(true)
  const [refreshing, setRefreshing]       = useState(false)
  const [refreshSteps, setRefreshSteps]   = useState(initialSteps)
  const [lastResult, setLastResult]       = useState(null)

  const loadReviews = useCallback(async () => {
    if (!restaurant) return
    setLoading(true)
    const { data } = await supabase
      .from('reviews')
      .select('id,author_name,rating,text,review_date,owner_replied,reply_text,suggested_reply')
      .eq('restaurant_id', restaurant.id)
      .order('review_date', { ascending: false })
      .limit(50)
    setReviews(data || [])
    setLoading(false)
  }, [restaurant?.id])

  useEffect(() => {
    if (!restaurant) { setLoading(false); return }
    loadReviews()
  }, [loadReviews])

  const startRefresh = () => {
    if (refreshing || !restaurant) return
    setRefreshing(true)
    setLastResult(null)
    setRefreshSteps(initialSteps())

    const es = new EventSource(`${API_URL}/refresh?restaurant_id=${restaurant.id}&max_reviews=10`)

    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (typeof data.step === 'number') {
        setRefreshSteps(prev =>
          prev.map((s, i) => i === data.step - 1 ? { ...s, status: data.status } : s)
        )
      }
    }

    es.addEventListener('done', (e) => {
      const data = JSON.parse(e.data)
      es.close()
      setRefreshing(false)
      setLastResult({ new_count: data.new_count })
      if (data.new_count > 0) loadReviews()
    })

    es.onerror = () => {
      es.close()
      setRefreshing(false)
      setLastResult({ error: true })
    }
  }

  if (!restaurant) return <NoRestaurant label="las reseñas" />

  const replied    = reviews.filter(r => r.owner_replied).length
  const hasSuggest = reviews.filter(r => r.suggested_reply).length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-qinsa-blue px-4 pt-10 pb-4">
        <p className="text-white/50 text-xs font-medium uppercase tracking-widest">Últimas reseñas</p>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <h1 className="text-white text-lg font-bold truncate">{restaurant.name}</h1>
          <button
            onClick={startRefresh}
            disabled={refreshing}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            Actualizar
          </button>
        </div>
        {!loading && reviews.length > 0 && (
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-white/60 text-xs">{reviews.length} reseñas</span>
            <span className="text-white/60 text-xs">·</span>
            <span className="text-white/60 text-xs">{replied} respondidas</span>
            {hasSuggest > 0 && (
              <>
                <span className="text-white/60 text-xs">·</span>
                <span className="text-white/60 text-xs">{hasSuggest} sugerencias IA</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Refresh progress */}
        {refreshing && <RefreshProgress steps={refreshSteps} />}

        {/* Last refresh result toast */}
        {!refreshing && lastResult && (
          <div className={`text-center py-2 px-4 rounded-xl text-xs font-semibold ${
            lastResult.error
              ? 'bg-red-50 text-red-500'
              : lastResult.new_count > 0
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-500'
          }`}>
            {lastResult.error
              ? 'Error al conectar con la API — ¿está corriendo uvicorn?'
              : lastResult.new_count > 0
                ? `${lastResult.new_count} reseña${lastResult.new_count !== 1 ? 's' : ''} nueva${lastResult.new_count !== 1 ? 's' : ''} encontrada${lastResult.new_count !== 1 ? 's' : ''}`
                : 'Sin reseñas nuevas desde la última actualización'}
          </div>
        )}

        {loading ? (
          <Spinner />
        ) : reviews.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="font-medium">Sin reseñas</p>
            <p className="text-sm mt-1">No hay reseñas almacenadas aún</p>
          </div>
        ) : (
          reviews.map(r => <ReviewCard key={r.id} review={r} />)
        )}
      </div>
    </div>
  )
}
