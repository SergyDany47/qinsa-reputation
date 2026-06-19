import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signIn(email.trim(), password)
    setLoading(false)
    if (error) {
      setError('Email o contraseña incorrectos')
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-ocean-800">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2.5 mb-3">
            <div className="w-10 h-10 bg-lime-300 rounded-xl flex items-center justify-center">
              <span className="text-ocean-800 font-bold text-lg">Q</span>
            </div>
            <span className="text-white text-xl font-bold tracking-tight">Qinsa Reputation</span>
          </div>
          <p className="text-white/50 text-sm">Accede al panel de tu restaurante</p>
        </div>

        <form onSubmit={onSubmit} className="bg-surface rounded-2xl p-6 shadow-soft space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Email</label>
            <input
              type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="tu@restaurante.com"
              className="w-full px-4 py-3 bg-slate-50 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-ocean-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Contraseña</label>
            <input
              type="password" required autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              className="w-full px-4 py-3 bg-slate-50 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-ocean-500"
            />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <button
            type="submit" disabled={loading}
            className="w-full py-3 bg-ocean-600 text-white font-semibold rounded-xl hover:bg-ocean-700 active:scale-[0.98] transition disabled:opacity-60"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="text-center text-white/40 text-xs mt-6">¿Sin cuenta? Contacta con tu gestor de Qinsalabs.</p>
      </div>
    </div>
  )
}
