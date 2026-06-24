import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useRestaurant } from '../lib/RestaurantContext'
import { useAuth } from '../lib/AuthContext'
import Spinner from '../components/Spinner'
import NoRestaurant from '../components/NoRestaurant'
import { Card, PageHeader, EmptyState } from '../components/ui'

const RATING_BADGE = {
  5: 'bg-emerald-100 text-emerald-700', 4: 'bg-green-100 text-green-700',
  3: 'bg-amber-100 text-amber-700', 2: 'bg-orange-100 text-orange-700', 1: 'bg-red-100 text-red-700',
}

function Stars({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} className={`w-3.5 h-3.5 ${i <= rating ? 'text-amber-400' : 'text-slate-200'}`} viewBox="0 0 20 20" fill="currentColor"><path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.07 3.29a1 1 0 00.95.69h3.46c.97 0 1.37 1.24.59 1.81l-2.8 2.03a1 1 0 00-.36 1.12l1.07 3.29c.3.92-.76 1.69-1.54 1.12l-2.8-2.03a1 1 0 00-1.18 0l-2.8 2.03c-.78.57-1.84-.2-1.54-1.12l1.07-3.29a1 1 0 00-.36-1.12L2.64 8.72c-.78-.57-.38-1.81.59-1.81h3.46a1 1 0 00.95-.69L8.7 2.93z" /></svg>
      ))}
    </div>
  )
}

const fmtDate = (d) => d ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d)) : ''

function ReviewCard({ review, onApprove }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const text = review.text || ''
  const isLong = text.length > 240
  const shown = !isLong || expanded ? text : text.slice(0, 240) + '…'
  const rating = review.rating || 0
  const approved = review.reply_status === 'approved'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(review.suggested_reply)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard no disponible */ }
  }

  return (
    <Card className="p-4 lg:p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-700 truncate">{review.author_name || 'Anónimo'}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Stars rating={rating} />
            {review.review_date && <span className="text-xs text-slate-400">{fmtDate(review.review_date)}</span>}
          </div>
        </div>
        <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-lg ${RATING_BADGE[rating] || 'bg-slate-100 text-slate-500'}`}>{rating}★</span>
      </div>

      {text ? (
        <>
          <p className="text-sm text-slate-600 leading-relaxed">{shown}</p>
          {isLong && <button onClick={() => setExpanded(e => !e)} className="text-xs text-ocean-600 font-semibold mt-1 self-start">{expanded ? 'Ver menos' : 'Ver más'}</button>}
        </>
      ) : (
        <p className="text-xs text-slate-400 italic">Sin texto</p>
      )}

      {/* Respuesta publicada del propietario */}
      {review.owner_replied && review.reply_text ? (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 mb-1.5">
            <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span className="text-xs text-emerald-700 font-semibold">Respondida en Google</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed pl-5">{review.reply_text}</p>
        </div>
      ) : review.suggested_reply ? (
        /* Sugerencia IA lista para usar */
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <svg className="w-3.5 h-3.5 text-ocean-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
              <span className="text-xs text-ocean-700 font-bold truncate">Respuesta sugerida</span>
              {approved && (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Aprobada</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => onApprove(review.id, !approved)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${approved ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-ocean-300 text-ocean-700 hover:bg-ocean-50'}`}
                title={approved ? 'Quitar aprobación' : 'Marcar como aprobada'}
              >
                {approved ? '✓ Aprobada' : 'Aprobar'}
              </button>
              <button onClick={copy} className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-ocean-600 text-white hover:bg-ocean-700'}`}>
                {copied ? '✓ Copiada' : 'Copiar'}
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed pl-5">{review.suggested_reply}</p>
        </div>
      ) : text ? (
        <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400 italic">Pendiente de generar sugerencia</p>
      ) : null}
    </Card>
  )
}

const STATUS_FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'to_approve', label: 'Por aprobar' },
  { key: 'needs_reply', label: 'Sin responder' },
  { key: 'positive', label: 'Positivas (4-5★)' },
  { key: 'negative', label: 'Negativas (1-2★)' },
]
const DATE_FILTERS = [
  { key: 'all_time', label: 'Cualquier fecha' },
  { key: '30_days', label: 'Últimos 30 días' },
  { key: '3_months', label: 'Últimos 3 meses' },
  { key: '1_year', label: 'Último año' },
]

export default function Resenas() {
  const { restaurant, loading: loadingRestaurant } = useRestaurant()
  const { user } = useAuth()
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all_time')

  const loadReviews = useCallback(async () => {
    if (!restaurant) return
    setLoading(true)
    const { data } = await supabase.from('reviews')
      .select('id,author_name,rating,text,review_date,owner_replied,reply_text,suggested_reply,reply_status')
      .eq('restaurant_id', restaurant.id).order('review_date', { ascending: false }).limit(100)
    setReviews(data || [])
    setLoading(false)
  }, [restaurant?.id])

  // Aprobar / desaprobar una sugerencia (draft ↔ approved). Update optimista
  // y persistencia por RLS (el miembro tiene UPDATE sobre sus reviews).
  const setApproval = useCallback(async (reviewId, approve) => {
    const newStatus = approve ? 'approved' : 'draft'
    const prevStatus = approve ? 'draft' : 'approved'
    setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, reply_status: newStatus } : r))
    const patch = approve
      ? { reply_status: 'approved', reply_approved_at: new Date().toISOString(), reply_approved_by: user?.id || null }
      : { reply_status: 'draft', reply_approved_at: null, reply_approved_by: null }
    const { error } = await supabase.from('reviews').update(patch).eq('id', reviewId)
    if (error) {
      setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, reply_status: prevStatus } : r))
    }
  }, [user?.id])

  useEffect(() => {
    if (!restaurant) { setLoading(false); return }
    loadReviews()
  }, [loadReviews])

  const filtered = useMemo(() => reviews.filter(r => {
    if (dateFilter !== 'all_time' && r.review_date) {
      const days = Math.ceil(Math.abs(Date.now() - new Date(r.review_date)) / 86400000)
      if (dateFilter === '30_days' && days > 30) return false
      if (dateFilter === '3_months' && days > 90) return false
      if (dateFilter === '1_year' && days > 365) return false
    }
    if (filter === 'to_approve') return !r.owner_replied && r.suggested_reply && r.reply_status !== 'approved'
    if (filter === 'needs_reply') return !r.owner_replied && r.text
    if (filter === 'positive') return r.rating >= 4
    if (filter === 'negative') return r.rating <= 2
    return true
  }), [reviews, filter, dateFilter])

  if (loadingRestaurant) return <div className="py-20"><Spinner /></div>
  if (!restaurant) return <NoRestaurant />

  const replied = reviews.filter(r => r.owner_replied).length
  const suggestions = reviews.filter(r => r.suggested_reply && !r.owner_replied).length
  const approvedCount = reviews.filter(r => r.suggested_reply && !r.owner_replied && r.reply_status === 'approved').length

  return (
    <div>
      <PageHeader overline="Reseñas" title="Bandeja de reseñas" meta={!loading && reviews.length > 0 && (
        <>
          <span>{reviews.length} reseñas</span>
          <span>{replied} respondidas</span>
          {suggestions > 0 && <span className="text-ocean-600 font-medium">{suggestions} sugerencia{suggestions !== 1 ? 's' : ''} lista{suggestions !== 1 ? 's' : ''}</span>}
          {approvedCount > 0 && <span className="text-emerald-600 font-medium">{approvedCount} aprobada{approvedCount !== 1 ? 's' : ''}</span>}
        </>
      )} />

      {/* Filtros */}
      {!loading && reviews.length > 0 && (
        <div className="space-y-2 mb-5">
          <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
            {STATUS_FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${filter === f.key ? 'bg-ocean-600 text-white' : 'bg-surface text-slate-600 border border-slate-200 hover:border-ocean-300'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
            {DATE_FILTERS.map(f => (
              <button key={f.key} onClick={() => setDateFilter(f.key)}
                className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${dateFilter === f.key ? 'bg-ocean-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-20"><Spinner /></div>
      ) : reviews.length === 0 ? (
        <EmptyState title="Sin reseñas" subtitle="Todavía no hay reseñas almacenadas para este local." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No hay resultados" subtitle="Prueba con otro filtro." />
      ) : (
        <div className="grid lg:grid-cols-2 gap-3 lg:gap-4 items-start">
          {filtered.map(r => <ReviewCard key={r.id} review={r} onApprove={setApproval} />)}
        </div>
      )}
    </div>
  )
}
