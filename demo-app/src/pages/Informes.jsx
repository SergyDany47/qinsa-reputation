import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRestaurant } from '../lib/RestaurantContext'
import Spinner from '../components/Spinner'
import NoRestaurant from '../components/NoRestaurant'
import { Card, SectionLabel, PageHeader, EmptyState } from '../components/ui'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** "15–21 jun" — period_end es exclusivo (lunes siguiente), así que mostramos -1 día. */
function weekLabel(start, end) {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  e.setDate(e.getDate() - 1)
  const sameMonth = s.getMonth() === e.getMonth()
  const left = sameMonth ? `${s.getDate()}` : `${s.getDate()} ${MONTHS[s.getMonth()]}`
  return `${left}–${e.getDate()} ${MONTHS[e.getMonth()]}`
}

/** Parte el summary (3 viñetas "- **Título:** cuerpo") en estructura; si no casa, null. */
function parseBullets(summary) {
  if (!summary) return null
  const out = []
  for (const raw of summary.split('\n')) {
    const m = raw.trim().match(/^[-*]\s*\*\*(.+?)\*\*[:\s]*(.*)$/)
    if (m) out.push({ title: m[1].replace(/:$/, ''), body: m[2].trim() })
  }
  return out.length ? out : null
}

const fmtNum = (v) => (v == null ? '—' : Number.isInteger(v) ? v : Number(v).toFixed(1))

/** Flecha de variación coloreada según si "subir" es bueno para esta métrica. */
function Delta({ value, suffix = '', goodWhenUp = true }) {
  if (value == null) return <span className="text-slate-300 text-xs">—</span>
  if (value === 0) return <span className="text-slate-400 text-xs">=</span>
  const up = value > 0
  const good = up === goodWhenUp
  const color = good ? 'text-emerald-600' : 'text-red-500'
  return (
    <span className={`text-xs font-semibold ${color}`}>
      {up ? '▲' : '▼'} {Math.abs(value)}{suffix}
    </span>
  )
}

function MetricCard({ label, value, sub, delta }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-ocean-800">{value}</span>
        {sub && <span className="text-xs text-slate-400">{sub}</span>}
      </div>
      <div className="mt-1">{delta}</div>
    </Card>
  )
}

const BULLET_ACCENT = ['border-ocean-300 bg-ocean-50/60', 'border-lime-400 bg-lime-100/40', 'border-emerald-300 bg-emerald-50/60']

export default function Informes() {
  const { restaurant, loading: loadingRestaurant } = useRestaurant()
  const [reports, setReports] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!restaurant) { setLoading(false); return }
    let active = true
    setLoading(true)
    supabase
      .from('reports')
      .select('id,period_start,period_end,summary,payload,created_at')
      .eq('restaurant_id', restaurant.id)
      .order('period_start', { ascending: false })
      .limit(12)
      .then(({ data }) => {
        if (!active) return
        const list = data || []
        setReports(list)
        setSelectedId(list[0]?.id || null)
        setLoading(false)
      })
    return () => { active = false }
  }, [restaurant?.id])

  if (loadingRestaurant) return <div className="py-20"><Spinner /></div>
  if (!restaurant) return <NoRestaurant />
  if (loading) return <div className="py-20"><Spinner /></div>

  if (!reports.length) {
    return (
      <div>
        <PageHeader overline="Informes semanales" title={restaurant.name} />
        <EmptyState
          title="Aún no hay informes"
          subtitle="Cada semana recibirás aquí un parte con la evolución de tus reseñas, la satisfacción y una recomendación accionable."
        />
      </div>
    )
  }

  const report = reports.find((r) => r.id === selectedId) || reports[0]
  const p = report.payload || {}
  const cur = p.current || {}
  const d = p.deltas || {}
  const ins = p.insights || {}
  const bullets = parseBullets(report.summary)

  const dist = cur.rating_distribution || {}
  const distTotal = Object.values(dist).reduce((a, b) => a + Number(b), 0)
  const distMax = Math.max(...Object.values(dist).map(Number), 1)

  return (
    <div>
      <PageHeader
        overline="Informes semanales"
        title={restaurant.name}
        meta={<span>Parte de dirección · comparativa semana a semana</span>}
      />

      {/* Selector de semanas */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-5">
        {reports.map((r) => {
          const active = r.id === report.id
          return (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`shrink-0 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                active
                  ? 'bg-ocean-600 text-white border-ocean-600'
                  : 'bg-surface text-slate-600 border-slate-200 hover:border-ocean-300'
              }`}
            >
              {weekLabel(r.period_start, r.period_end)}
            </button>
          )
        })}
      </div>

      {/* Narrativa de dirección */}
      <div className="mb-6">
        <SectionLabel dot="bg-ocean-500">Síntesis de dirección</SectionLabel>
        {bullets ? (
          <div className="space-y-2.5">
            {bullets.map((b, i) => (
              <div key={i} className={`rounded-xl border-l-4 ${BULLET_ACCENT[i % BULLET_ACCENT.length]} px-4 py-3`}>
                <p className="text-sm font-bold text-ocean-800">{b.title}</p>
                <p className="text-sm text-slate-600 leading-snug mt-0.5">{b.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <Card className="p-5">
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{report.summary}</p>
          </Card>
        )}
      </div>

      {/* Métricas de la semana + variación */}
      <SectionLabel dot="bg-lime-500">La semana en cifras</SectionLabel>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
        <MetricCard
          label="Reseñas nuevas" value={fmtNum(cur.count)}
          delta={<Delta value={d.count} goodWhenUp />}
        />
        <MetricCard
          label="Rating medio" value={fmtNum(cur.avg_rating)} sub="/5"
          delta={<Delta value={d.avg_rating} goodWhenUp />}
        />
        <MetricCard
          label="Positivas (4-5★)" value={fmtNum(cur.positive)}
          delta={<Delta value={d.positive} goodWhenUp />}
        />
        <MetricCard
          label="Tasa de respuesta" value={cur.response_rate == null ? '—' : `${fmtNum(cur.response_rate)}%`}
          delta={<Delta value={d.response_rate} suffix="%" goodWhenUp />}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Distribución de la semana */}
        {distTotal > 0 && (
          <Card className="p-5">
            <SectionLabel dot="bg-ocean-500">Distribución de la semana</SectionLabel>
            <div className="space-y-2.5">
              {[5, 4, 3, 2, 1].map((s) => {
                const count = Number(dist[String(s)]) || 0
                const w = distMax ? (count / distMax) * 100 : 0
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-600 w-4">{s}★</span>
                    <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-ocean-400" style={{ width: `${w}%`, transition: 'width .6s ease' }} />
                    </div>
                    <span className="text-sm font-bold text-slate-700 w-6 text-right">{count}</span>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {/* Foco operativo desde insights */}
        <div className="space-y-5">
          {ins.staff_mentions?.length > 0 && (
            <div>
              <SectionLabel dot="bg-emerald-400">Personal mencionado</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {ins.staff_mentions.slice(0, 6).map((m, i) => (
                  <span key={i} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-100 text-emerald-700">
                    {m.name}{m.mention_count ? ` · ${m.mention_count}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
          {ins.recurring_issues?.length > 0 && (
            <div>
              <SectionLabel dot="bg-red-400">Focos a vigilar</SectionLabel>
              <div className="space-y-2">
                {ins.recurring_issues.slice(0, 3).map((it, i) => (
                  <div key={i} className="text-sm text-slate-700 bg-red-50/70 border border-red-100 rounded-xl px-3.5 py-2.5 leading-snug">{it}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-6">
        Generado el {new Date(report.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
        {' · '}comparado con la semana anterior
      </p>
    </div>
  )
}
