import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, streamIngest, streamRegenerate } from '../lib/api'
import ContextEditor from './ContextEditor'

const FREQ_OPTIONS = [3, 6, 12, 24, 48]

function fmtLast(ts) {
  if (!ts) return 'nunca'
  const d = new Date(ts)
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)
}

const STEP_LABEL = { 1: 'Scraping', 2: 'Análisis', 3: 'Guardado' }

function StepDot({ status }) {
  const color =
    status === 'done' ? 'bg-qinsa-green'
      : status === 'running' ? 'bg-qinsa-blue animate-pulse'
      : status === 'error' ? 'bg-red-400'
      : 'bg-slate-200'
  return <span className={`w-2 h-2 rounded-full ${color}`} />
}

export default function RestaurantRow({ restaurant, orgId }) {
  const qc = useQueryClient()
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState([])
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [editingContext, setEditingContext] = useState(false)
  const [regen, setRegen] = useState(null) // {processed,total} | null
  const [regenResult, setRegenResult] = useState(null)
  const abortRef = useRef(null)

  // Config operativa (modelo + counts). Cacheada por React Query; cae a defaults
  // sensatos si aún no ha cargado.
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const model = settings?.config?.default_model || 'gemini-2.5-flash'
  const refreshCount = settings?.config?.default_refresh_count || 10
  const historicalCount = settings?.config?.default_historical_count || 100

  const scheduleMutation = useMutation({
    mutationFn: (body) => api.updateSchedule(restaurant.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization', orgId] }),
  })
  const autoEnabled = restaurant.auto_ingest_enabled
  const freq = restaurant.ingest_frequency_hours || 6

  const hasData = restaurant.review_count != null && restaurant.review_count > 0
  const canIngest = !!restaurant.place_id

  const run = (opts) => {
    if (running) return
    setRunning(true)
    setSteps([])
    setError(null)
    setResult(null)

    abortRef.current = streamIngest(restaurant.id, opts, (event, data) => {
      if (event === 'done') {
        setRunning(false)
        setResult(data)
        qc.invalidateQueries({ queryKey: ['organization', orgId] })
        return
      }
      if (data.status === 'error' && typeof data.step !== 'number') {
        setError(data.message)
        setRunning(false)
        return
      }
      if (typeof data.step === 'number') {
        setSteps((prev) => {
          const next = [...prev]
          const idx = next.findIndex((s) => s.step === data.step)
          const entry = { step: data.step, status: data.status, message: data.message }
          if (idx >= 0) next[idx] = entry
          else next.push(entry)
          return next
        })
      }
    })
  }

  const regenerate = () => {
    if (regen) return
    setRegen({ processed: 0, total: 0 })
    setRegenResult(null)
    setError(null)
    abortRef.current = streamRegenerate(restaurant.id, { model }, (event, data) => {
      if (event === 'done') {
        setRegen(null)
        setRegenResult(data)
        return
      }
      if (data.status === 'error') {
        setError(data.message)
        setRegen(null)
        return
      }
      if (typeof data.total === 'number') {
        setRegen({ processed: data.processed, total: data.total })
      }
    })
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">{restaurant.name}</p>
          {restaurant.place_id ? (
            <p className="text-xs text-slate-400 font-mono truncate">{restaurant.place_id}</p>
          ) : (
            <p className="text-xs text-amber-600">Sin place_id — no se puede ingestar</p>
          )}
        </div>
        <div className="text-right text-xs text-slate-400 shrink-0">
          {hasData ? `${restaurant.review_count} reseñas` : 'sin datos'}
        </div>
      </div>

      {canIngest && (
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            onClick={() => run({ maxReviews: refreshCount, generateReplies: true, model })}
            disabled={running}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-qinsa-green text-white disabled:opacity-50"
          >
            {hasData ? `Refresh (${refreshCount})` : `Primera ingesta (${refreshCount})`}
          </button>
          <button
            onClick={() => run({ maxReviews: historicalCount, generateReplies: false, model })}
            disabled={running}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-qinsa-blue text-white disabled:opacity-50"
            title="Recopila reseñas para construir histórico e insights (sin generar respuestas IA)"
          >
            Carga histórica ({historicalCount})
          </button>
          <button
            onClick={() => setEditingContext((v) => !v)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${editingContext ? 'bg-slate-100 border-slate-300 text-slate-700' : 'border-slate-200 text-slate-600 hover:border-qinsa-blue'}`}
          >
            Configurar IA
          </button>
          {hasData && (
            <button
              onClick={regenerate}
              disabled={!!regen || running}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-qinsa-green/50 text-qinsa-green hover:bg-qinsa-green/5 disabled:opacity-50"
              title="Regenera las respuestas IA de las reseñas ya guardadas con el contexto actual (no usa Apify)"
            >
              Regenerar respuestas IA
            </button>
          )}
          {(running || regen) && (
            <button
              onClick={() => { abortRef.current?.(); setRunning(false); setRegen(null) }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:text-slate-700"
            >
              Cancelar
            </button>
          )}
        </div>
      )}

      {/* Auto-ingesta (motor programado) */}
      {canIngest && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="relative inline-block w-9 h-5">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={!!autoEnabled}
                disabled={scheduleMutation.isPending}
                onChange={(e) => scheduleMutation.mutate({ auto_ingest_enabled: e.target.checked, ingest_frequency_hours: freq })}
              />
              <span className="absolute inset-0 rounded-full bg-slate-200 peer-checked:bg-qinsa-green transition-colors" />
              <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
            </span>
            <span className="font-semibold text-slate-600">Auto-ingesta</span>
          </label>
          <label className="flex items-center gap-1.5 text-slate-500">
            cada
            <select
              value={freq}
              disabled={scheduleMutation.isPending}
              onChange={(e) => scheduleMutation.mutate({ auto_ingest_enabled: !!autoEnabled, ingest_frequency_hours: Number(e.target.value) })}
              className="px-2 py-1 bg-white border border-slate-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-qinsa-green"
            >
              {FREQ_OPTIONS.map((h) => <option key={h} value={h}>{h}h</option>)}
            </select>
          </label>
          <span className="text-slate-400">Última: {fmtLast(restaurant.last_ingest_at)}</span>
        </div>
      )}

      {editingContext && (
        <div className="mt-3">
          <ContextEditor restaurantId={restaurant.id} onClose={() => setEditingContext(false)} />
        </div>
      )}

      {/* Progreso */}
      {(running || steps.length > 0) && !error && (
        <div className="mt-2 space-y-1">
          {steps.map((s) => (
            <div key={s.step} className="flex items-center gap-2 text-xs text-slate-500">
              <StepDot status={s.status} />
              <span className="font-medium text-slate-600">{STEP_LABEL[s.step]}:</span>
              <span className="truncate">{s.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Progreso de regeneración */}
      {regen && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Regenerando respuestas IA…</span>
            <span>{regen.processed}/{regen.total || '?'}</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-qinsa-green rounded-full transition-all" style={{ width: regen.total ? `${(regen.processed / regen.total) * 100}%` : '8%' }} />
          </div>
        </div>
      )}
      {regenResult && (
        <p className="mt-2 text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5">
          ✓ {regenResult.regenerated} respuesta(s) IA regenerada(s) con el contexto actual
        </p>
      )}

      {result && (
        <p className="mt-2 text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5">
          ✓ {result.inserted} reseña(s) nueva(s) de {result.scraped} recopiladas
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">{error}</p>
      )}
    </li>
  )
}
