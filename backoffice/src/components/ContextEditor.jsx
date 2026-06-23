import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import Spinner from './Spinner'

function TagInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = draft.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-white border border-slate-200 rounded-lg focus-within:ring-2 focus-within:ring-qinsa-green">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 bg-qinsa-light text-qinsa-blue text-xs font-semibold pl-2 pr-1 py-0.5 rounded-md">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="text-qinsa-blue/60 hover:text-qinsa-blue">×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }}
        onBlur={add}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[8rem] text-sm py-0.5 outline-none bg-transparent"
      />
    </div>
  )
}

const FIELD = 'w-full px-3 py-2 bg-white rounded-lg text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-qinsa-green'
const LABEL = 'block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide'

export default function ContextEditor({ restaurantId, onClose }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['context', restaurantId],
    queryFn: () => api.getContext(restaurantId),
  })
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!data) return
    const c = data.context || {}
    const d = data.options.defaults
    setForm({
      tone_preset: c.tone_preset || d.tone_preset,
      emoji_level: c.emoji_level || d.emoji_level,
      language_mode: c.language_mode || d.language_mode,
      signature: c.signature || '',
      instructions: c.instructions || '',
      keywords_objetivo: c.keywords_objetivo || [],
      dishes: c.dishes || [],
    })
  }, [data])

  const mutation = useMutation({
    mutationFn: () => api.updateContext(restaurantId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context', restaurantId] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  if (isLoading || !form) return <div className="bg-slate-50 rounded-lg p-4 mb-3"><Spinner /></div>
  const opts = data.options

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}
      className="bg-slate-50 rounded-xl p-4 mb-3 space-y-4 border border-slate-200"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-slate-700">Configuración del local · respuestas IA</h4>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">Cerrar</button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className={LABEL}>Tono</label>
          <select value={form.tone_preset} onChange={(e) => set('tone_preset', e.target.value)} className={FIELD}>
            {opts.tone_presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <p className="text-[11px] text-slate-400 mt-1 leading-tight">
            {opts.tone_presets.find((p) => p.key === form.tone_preset)?.description}
          </p>
        </div>
        <div>
          <label className={LABEL}>Emojis</label>
          <select value={form.emoji_level} onChange={(e) => set('emoji_level', e.target.value)} className={FIELD}>
            {opts.emoji_levels.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>Idioma de respuesta</label>
          <select value={form.language_mode} onChange={(e) => set('language_mode', e.target.value)} className={FIELD}>
            {opts.language_modes.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={LABEL}>Firma</label>
        <input value={form.signature} onChange={(e) => set('signature', e.target.value)} placeholder="Ej: La familia Rosi (vacío = nombre del local)" className={FIELD} />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Keywords SEO</label>
          <TagInput value={form.keywords_objetivo} onChange={(v) => set('keywords_objetivo', v)} placeholder="Enter para añadir: mejor mexicano de Madrid…" />
        </div>
        <div>
          <label className={LABEL}>Platos estrella / señas</label>
          <TagInput value={form.dishes} onChange={(v) => set('dishes', v)} placeholder="Enter para añadir: tacos al pastor…" />
        </div>
      </div>

      <div>
        <label className={LABEL}>Instrucciones adicionales (opcional)</label>
        <textarea value={form.instructions} onChange={(e) => set('instructions', e.target.value)} rows={2}
          placeholder="Ej: tenemos terraza; no ofrezcas descuentos…" className={`${FIELD} resize-none`} />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={mutation.isPending} className="px-4 py-2 bg-qinsa-green text-white text-sm font-semibold rounded-lg disabled:opacity-60">
          {mutation.isPending ? 'Guardando…' : 'Guardar configuración'}
        </button>
        {saved && <span className="text-sm text-emerald-600 font-medium">✓ Guardado</span>}
        {mutation.isError && <span className="text-sm text-red-600">{mutation.error.message}</span>}
        <span className="text-xs text-slate-400 ml-auto">Aplica en la próxima ingesta / refresh</span>
      </div>
    </form>
  )
}
