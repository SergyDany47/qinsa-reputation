import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

function fmt(ts) {
  if (!ts) return ''
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ts))
}

const TRIGGER_LABEL = { manual: 'Manual', scheduled: 'Programada' }

/** Historial de ejecuciones de ingesta de un restaurante (manual + cron). */
export default function RunHistory({ restaurantId }) {
  const { data: runs, isLoading, isError, error } = useQuery({
    queryKey: ['runs', restaurantId],
    queryFn: () => api.getRuns(restaurantId, { limit: 20 }),
  })

  if (isLoading) return <p className="text-xs text-slate-400 px-1 py-2">Cargando historial…</p>
  if (isError) return <p className="text-xs text-red-600 px-1 py-2">{error?.message || 'Error al cargar el historial'}</p>
  if (!runs?.length) return <p className="text-xs text-slate-400 px-1 py-2">Aún no hay ejecuciones registradas.</p>

  return (
    <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 text-slate-500 text-left">
            <th className="font-semibold px-3 py-2">Fecha</th>
            <th className="font-semibold px-3 py-2">Origen</th>
            <th className="font-semibold px-3 py-2">Estado</th>
            <th className="font-semibold px-3 py-2 text-right">Recopiladas</th>
            <th className="font-semibold px-3 py-2 text-right">Nuevas</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const ok = r.status === 'success'
            return (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmt(r.created_at)}</td>
                <td className="px-3 py-2 text-slate-500">{TRIGGER_LABEL[r.trigger] || r.trigger}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 font-semibold ${ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    {ok ? 'Éxito' : 'Error'}
                  </span>
                  {!ok && r.error_message && (
                    <span className="block text-red-400 mt-0.5 max-w-[16rem] truncate" title={r.error_message}>
                      {r.error_message}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-slate-600">{r.reviews_scraped ?? '—'}</td>
                <td className="px-3 py-2 text-right font-semibold text-slate-700">
                  {ok ? (r.reviews_inserted ?? 0) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
