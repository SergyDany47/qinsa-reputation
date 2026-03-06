import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRestaurant } from '../App'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const STEPS = [
  { label: 'Scraping reseñas', desc: 'Obteniendo reseñas de Google Maps via Apify' },
  { label: 'Analizando con IA', desc: 'Gemini extrae insights, empleados y tendencias' },
  { label: 'Guardando en BD', desc: 'Persistiendo datos en Supabase' },
]

function StepRow({ index, status, message }) {
  const isPending = status === 'pending'
  const isRunning = status === 'running'
  const isDone    = status === 'done'
  const isError   = status === 'error'

  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all duration-300 ${
      isRunning ? 'bg-blue-50 border-blue-100' :
      isDone    ? 'bg-emerald-50 border-emerald-100' :
      isError   ? 'bg-red-50 border-red-100' :
      'bg-slate-50 border-slate-100'
    }`}>
      {/* Step indicator */}
      <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold transition-all ${
        isRunning ? 'bg-qinsa-blue text-white animate-pulse' :
        isDone    ? 'bg-qinsa-green text-white' :
        isError   ? 'bg-red-400 text-white' :
        'bg-slate-200 text-slate-400'
      }`}>
        {isDone  ? '✓' :
         isError ? '✗' :
         index + 1}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${
          isRunning ? 'text-qinsa-blue' :
          isDone    ? 'text-emerald-700' :
          isError   ? 'text-red-600' :
          'text-slate-400'
        }`}>
          {STEPS[index].label}
        </p>
        {message ? (
          <p className="text-xs text-slate-500 mt-0.5 leading-snug">{message}</p>
        ) : isPending ? (
          <p className="text-xs text-slate-300 mt-0.5">{STEPS[index].desc}</p>
        ) : null}
      </div>
    </div>
  )
}

const initialSteps = () => [
  { status: 'pending', message: '' },
  { status: 'pending', message: '' },
  { status: 'pending', message: '' },
]

export default function Onboarding() {
  const [placeId, setPlaceId]       = useState('')
  const [maxReviews, setMaxReviews] = useState(50)
  const [running, setRunning]       = useState(false)
  const [error, setError]           = useState('')
  const [steps, setSteps]           = useState(initialSteps)
  const [showSteps, setShowSteps]   = useState(false)
  const esRef                       = useRef(null)
  const { setRestaurant }           = useRestaurant()
  const navigate                    = useNavigate()

  const updateStep = (idx, patch) =>
    setSteps(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))

  const start = () => {
    const id = placeId.trim()
    if (!id) { setError('Introduce un Place ID de Google Maps'); return }

    setError('')
    setRunning(true)
    setShowSteps(true)
    setSteps(initialSteps())

    const url = `${API_URL}/analyze?place_id=${encodeURIComponent(id)}&max_reviews=${maxReviews}`
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (typeof data.step === 'number') {
        updateStep(data.step - 1, { status: data.status, message: data.message || '' })
      }
      // Error sin step = error global (ej. excepción no capturada)
      if (data.status === 'error' && typeof data.step !== 'number') {
        setError(data.message || 'Error desconocido')
        setRunning(false)
        es.close()
      }
    }

    es.addEventListener('done', (e) => {
      const data = JSON.parse(e.data)
      es.close()
      setRunning(false)
      setRestaurant(data.restaurant)
      navigate('/resumen')
    })

    es.onerror = () => {
      es.close()
      setRunning(false)
      setError('Error de conexión con la API. ¿Está corriendo uvicorn en el puerto 8000?')
    }
  }

  const cancel = () => {
    esRef.current?.close()
    setRunning(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-qinsa-blue px-4 pt-10 pb-5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 bg-qinsa-green rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-xs">Q</span>
          </div>
          <span className="text-white/60 text-xs font-medium tracking-widest uppercase">Pipeline</span>
        </div>
        <h1 className="text-white text-xl font-bold">Nuevo análisis</h1>
        <p className="text-white/50 text-xs mt-0.5">Scraping + IA + Supabase en tiempo real</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-4">

          {/* Place ID */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">
              Place ID de Google Maps
            </label>
            <input
              type="text"
              value={placeId}
              onChange={e => { setPlaceId(e.target.value); setError('') }}
              disabled={running}
              placeholder="ChIJ7dkd3PibQQ0RwV6PkU_5tTo"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-qinsa-green disabled:opacity-50 font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">
              Obtén el ID con <span className="font-mono text-slate-500">compass/crawler-google-places</span> en Apify
            </p>
          </div>

          {/* Número de reseñas */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">
              Número de reseñas
            </label>
            <div className="flex gap-2">
              {[20, 50, 100].map(n => (
                <button
                  key={n}
                  onClick={() => setMaxReviews(n)}
                  disabled={running}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-colors disabled:opacity-50 ${
                    maxReviews === n
                      ? 'bg-qinsa-blue text-white border-qinsa-blue'
                      : 'bg-white text-slate-500 border-slate-200 active:bg-slate-50'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl">
              <span className="text-red-400 text-sm shrink-0">⚠</span>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* CTA */}
          {!running ? (
            <button
              onClick={start}
              className="w-full py-3.5 bg-qinsa-green text-white font-bold rounded-xl active:scale-[0.98] transition-transform text-base"
            >
              Analizar
            </button>
          ) : (
            <button
              onClick={cancel}
              className="w-full py-3 bg-slate-100 text-slate-500 font-semibold rounded-xl active:scale-[0.98] transition-transform"
            >
              Cancelar
            </button>
          )}
        </div>

        {/* Progress steps */}
        {showSteps && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1">Progreso</p>
            {steps.map((s, i) => (
              <StepRow
                key={i}
                index={i}
                status={s.status}
                message={s.message}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
