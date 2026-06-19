import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import Spinner from '../components/Spinner'

function SecretStatus({ label, state }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-slate-700">{label}</span>
      {state.configured ? (
        <span className="flex items-center gap-2 text-sm">
          <span className="text-xs font-mono text-slate-400">{state.hint}</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            configurado
          </span>
        </span>
      ) : (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
          sin configurar
        </span>
      )}
    </div>
  )
}

export default function Settings() {
  const qc = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  })

  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(false)

  // Sincroniza el formulario local cuando llegan los datos
  useEffect(() => {
    if (data) {
      setForm({
        default_model: data.config.default_model,
        default_refresh_count: data.config.default_refresh_count,
        default_historical_count: data.config.default_historical_count,
      })
    }
  }, [data])

  const mutation = useMutation({
    mutationFn: (body) => api.updateSettings(body),
    onSuccess: (fresh) => {
      qc.setQueryData(['settings'], fresh)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  if (isLoading || !form) return <Spinner />
  if (isError) {
    return (
      <p className="text-red-600 bg-red-50 rounded-lg px-4 py-3 text-sm">
        {error.status === 403
          ? 'Tu cuenta no tiene permisos de administrador de plataforma.'
          : `Error: ${error.message}`}
      </p>
    )
  }

  const onSubmit = (e) => {
    e.preventDefault()
    mutation.mutate(form)
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Configuración</h1>
      <p className="text-slate-500 text-sm mb-6">Parámetros operativos de la plataforma</p>

      <form onSubmit={onSubmit} className="bg-white rounded-xl border border-slate-200 p-5 mb-6 space-y-5">
        <h2 className="font-semibold text-slate-800">Pipeline</h2>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            Modelo de Gemini por defecto
          </label>
          <select
            value={form.default_model}
            onChange={(e) => setForm({ ...form, default_model: e.target.value })}
            className="w-full px-4 py-2.5 bg-slate-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-qinsa-green"
          >
            {data.allowed_models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              Reviews por refresh
            </label>
            <input
              type="number" min={5} max={50}
              value={form.default_refresh_count}
              onChange={(e) => setForm({ ...form, default_refresh_count: Number(e.target.value) })}
              className="w-full px-4 py-2.5 bg-slate-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-qinsa-green"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              Reviews en carga histórica
            </label>
            <input
              type="number" min={20} max={200}
              value={form.default_historical_count}
              onChange={(e) => setForm({ ...form, default_historical_count: Number(e.target.value) })}
              className="w-full px-4 py-2.5 bg-slate-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-qinsa-green"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="px-5 py-2.5 bg-qinsa-green text-white text-sm font-semibold rounded-lg disabled:opacity-60"
          >
            {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
          {saved && <span className="text-sm text-emerald-600 font-medium">✓ Guardado</span>}
          {mutation.isError && <span className="text-sm text-red-600">{mutation.error.message}</span>}
        </div>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-semibold text-slate-800 mb-1">Secretos</h2>
        <p className="text-xs text-slate-400 mb-3">
          Configurados en el <span className="font-mono">.env</span> del servidor (no editables por web por seguridad).
        </p>
        <div className="divide-y divide-slate-100">
          <SecretStatus label="APIFY_API_TOKEN" state={data.secrets.apify_api_token} />
          <SecretStatus label="GEMINI_API_KEY" state={data.secrets.gemini_api_key} />
        </div>
      </div>
    </div>
  )
}
