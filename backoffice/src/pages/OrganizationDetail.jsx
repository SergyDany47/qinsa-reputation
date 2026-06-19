import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import Spinner from '../components/Spinner'
import RestaurantRow from '../components/RestaurantRow'

const ROLE_STYLES = {
  owner: 'bg-qinsa-green/10 text-qinsa-green',
  admin: 'bg-blue-100 text-blue-700',
  member: 'bg-slate-100 text-slate-600',
  viewer: 'bg-slate-100 text-slate-500',
}

function Section({ title, action, children }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-800">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function AddMemberForm({ orgId, onClose }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('owner')

  const mutation = useMutation({
    mutationFn: () => api.addMember(orgId, { email: email.trim(), password, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization', orgId] })
      onClose()
    },
  })

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}
      className="bg-slate-50 rounded-lg p-4 mb-4 space-y-3"
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <input
          autoFocus required type="email" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="email del usuario"
          className="px-3 py-2 bg-white rounded-lg text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-qinsa-green"
        />
        <input
          required minLength={6} type="text" value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="contraseña inicial (mín. 6)"
          className="px-3 py-2 bg-white rounded-lg text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-qinsa-green"
        />
      </div>
      <div className="flex items-center gap-3">
        <select
          value={role} onChange={(e) => setRole(e.target.value)}
          className="px-3 py-2 bg-white rounded-lg text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-qinsa-green"
        >
          <option value="owner">owner</option>
          <option value="admin">admin</option>
          <option value="member">member</option>
          <option value="viewer">viewer</option>
        </select>
        <button
          type="submit" disabled={mutation.isPending}
          className="px-4 py-2 bg-qinsa-green text-white text-sm font-semibold rounded-lg disabled:opacity-60"
        >
          {mutation.isPending ? 'Añadiendo…' : 'Añadir usuario'}
        </button>
        <button type="button" onClick={onClose} className="text-slate-500 text-sm font-medium hover:text-slate-700">
          Cancelar
        </button>
      </div>
      {mutation.isError && <p className="text-sm text-red-600">{mutation.error.message}</p>}
    </form>
  )
}

function OnboardRestaurantForm({ orgId, onClose }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [placeId, setPlaceId] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.onboardRestaurant(orgId, { name: name.trim(), place_id: placeId.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization', orgId] })
      onClose()
    },
  })

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}
      className="bg-slate-50 rounded-lg p-4 mb-4 space-y-3"
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <input
          autoFocus required minLength={2} value={name}
          onChange={(e) => setName(e.target.value)} placeholder="Nombre del restaurante"
          className="px-3 py-2 bg-white rounded-lg text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-qinsa-green"
        />
        <input
          value={placeId} onChange={(e) => setPlaceId(e.target.value)}
          placeholder="Google place_id (ChIJ…)"
          className="px-3 py-2 bg-white rounded-lg text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-qinsa-green"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit" disabled={mutation.isPending}
          className="px-4 py-2 bg-qinsa-green text-white text-sm font-semibold rounded-lg disabled:opacity-60"
        >
          {mutation.isPending ? 'Dando de alta…' : 'Dar de alta'}
        </button>
        <button type="button" onClick={onClose} className="text-slate-500 text-sm font-medium hover:text-slate-700">
          Cancelar
        </button>
      </div>
      {mutation.isError && <p className="text-sm text-red-600">{mutation.error.message}</p>}
    </form>
  )
}

export default function OrganizationDetail() {
  const { id } = useParams()
  const [showMember, setShowMember] = useState(false)
  const [showRestaurant, setShowRestaurant] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['organization', id],
    queryFn: () => api.getOrganization(id),
  })

  if (isLoading) return <Spinner />
  if (isError) {
    return (
      <p className="text-red-600 bg-red-50 rounded-lg px-4 py-3 text-sm">
        {error.status === 404 ? 'Organización no encontrada.' : `Error: ${error.message}`}
      </p>
    )
  }

  const { organization: org, restaurants, members } = data

  return (
    <div>
      <Link to="/" className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-block">
        ← Organizaciones
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-800">{org.name}</h1>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-qinsa-light text-qinsa-blue">
          {org.plan}
        </span>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section
          title={`Usuarios (${members.length})`}
          action={
            !showMember && (
              <button onClick={() => setShowMember(true)} className="text-sm font-semibold text-qinsa-green">
                + Añadir
              </button>
            )
          }
        >
          {showMember && <AddMemberForm orgId={id} onClose={() => setShowMember(false)} />}
          {members.length === 0 ? (
            <p className="text-sm text-slate-400">Sin usuarios todavía.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-slate-700">{m.email || m.user_id}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_STYLES[m.role] || ROLE_STYLES.member}`}>
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={`Restaurantes (${restaurants.length})`}
          action={
            !showRestaurant && (
              <button onClick={() => setShowRestaurant(true)} className="text-sm font-semibold text-qinsa-green">
                + Onboarding
              </button>
            )
          }
        >
          {showRestaurant && <OnboardRestaurantForm orgId={id} onClose={() => setShowRestaurant(false)} />}
          {restaurants.length === 0 ? (
            <p className="text-sm text-slate-400">Sin restaurantes todavía.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {restaurants.map((r) => (
                <RestaurantRow key={r.id} restaurant={r} orgId={id} />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
