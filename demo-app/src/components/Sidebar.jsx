import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { NAV_ITEMS } from './navItems'

export default function Sidebar() {
  const { user, signOut } = useAuth()

  return (
    <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-ocean-800 text-white h-screen sticky top-0">
      {/* Marca */}
      <div className="px-6 h-16 flex items-center gap-2.5 border-b border-white/10">
        <div className="w-8 h-8 bg-lime-300 rounded-lg flex items-center justify-center">
          <span className="text-ocean-800 font-bold">Q</span>
        </div>
        <span className="font-semibold tracking-tight">Qinsa Reputation</span>
      </div>

      {/* Navegación */}
      <nav className="flex-1 px-3 py-5 space-y-1">
        {NAV_ITEMS.map(({ path, label, Icon, end }) => (
          <NavLink
            key={path}
            to={path}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
              }`
            }
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Usuario */}
      <div className="px-3 py-4 border-t border-white/10">
        <div className="px-3 mb-2">
          <p className="text-xs text-white/40 uppercase tracking-widest font-semibold">Sesión</p>
          <p className="text-sm text-white/80 truncate">{user?.email}</p>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
