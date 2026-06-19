import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export default function Layout({ children }) {
  const { user, signOut } = useAuth()

  const navClass = ({ isActive }) =>
    `text-sm font-medium transition-colors ${isActive ? 'text-white' : 'text-white/60 hover:text-white'}`

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-qinsa-blue">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-7 h-7 bg-qinsa-green rounded-md flex items-center justify-center">
                <span className="text-white font-bold text-sm">Q</span>
              </div>
              <span className="text-white font-semibold">Qinsa Backoffice</span>
            </Link>
            <nav className="flex items-center gap-4">
              <NavLink to="/" end className={navClass}>Organizaciones</NavLink>
              <NavLink to="/settings" className={navClass}>Configuración</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-white/60 text-sm hidden sm:inline">{user?.email}</span>
            <button
              onClick={signOut}
              className="text-white/70 hover:text-white text-sm font-medium transition-colors"
            >
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
