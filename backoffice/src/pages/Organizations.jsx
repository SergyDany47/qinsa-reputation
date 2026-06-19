import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import Spinner from '../components/Spinner'

const PLAN_STYLES = {
  internal: 'bg-slate-100 text-slate-600',
  trial: 'bg-amber-100 text-amber-700',
  basic: 'bg-blue-100 text-blue-700',
  growth: 'bg-emerald-100 text-emerald-700',
}

function PlanBadge({ plan }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PLAN_STYLES[plan] || PLAN_STYLES.trial}`}>
      {plan}
    </span>
  )
}

function CreateOrgForm({ onClose }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [plan, setPlan] = useState('trial')

  const mutation = useMutation({
    mutationFn: () => api.createOrganization({ name: name.trim(), plan }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
      onClose()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate()
      }}
      className="bg-white rounded-xl border border-slate-200 p-5 mb-6 shadow-sm"
    >
      <h3 className="font-semibold text-slate-800 mb-4">Nueva organización</h3>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          autoFocus
          required
          minLength={2}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del cliente / grupo"
          className="flex-1 px-4 py-2.5 bg-slate-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-qinsa-green"
        />
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="px-4 py-2.5 bg-slate-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-qinsa-green"
        >
          <option value="trial">trial</option>
          <option value="basic">basic</option>
          <option value="growth">growth</option>
        </select>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="px-5 py-2.5 bg-qinsa-green text-white text-sm font-semibold rounded-lg disabled:opacity-60"
        >
          {mutation.isPending ? 'Creando…' : 'Crear'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 text-slate-500 text-sm font-medium hover:text-slate-700"
        >
          Cancelar
        </button>
      </div>
      {mutation.isError && (
        <p className="text-sm text-red-600 mt-3">{mutation.error.message}</p>
      )}
    </form>
  )
}

export default function Organizations() {
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const { data: orgs, isLoading, isError, error } = useQuery({
    queryKey: ['organizations'],
    queryFn: api.listOrganizations,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Organizaciones</h1>
          <p className="text-slate-500 text-sm mt-0.5">Clientes y grupos de la plataforma</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2.5 bg-qinsa-blue text-white text-sm font-semibold rounded-lg hover:bg-qinsa-blue/90 transition-colors"
          >
            + Nueva organización
          </button>
        )}
      </div>

      {showForm && <CreateOrgForm onClose={() => setShowForm(false)} />}

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <p className="text-red-600 bg-red-50 rounded-lg px-4 py-3 text-sm">
          {error.status === 403
            ? 'Tu cuenta no tiene permisos de administrador de plataforma.'
            : `Error cargando organizaciones: ${error.message}`}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((o) => (
            <button
              key={o.id}
              onClick={() => navigate(`/org/${o.id}`)}
              className="text-left bg-white rounded-xl border border-slate-200 p-5 hover:border-qinsa-green hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <h3 className="font-semibold text-slate-800 leading-tight">{o.name}</h3>
                <PlanBadge plan={o.plan} />
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-500">
                <span>{o.restaurant_count} restaurante{o.restaurant_count === 1 ? '' : 's'}</span>
                <span>{o.member_count} usuario{o.member_count === 1 ? '' : 's'}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
