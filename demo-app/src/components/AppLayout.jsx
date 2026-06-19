import { Outlet } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'
import RestaurantSwitcher from './RestaurantSwitcher'

export default function AppLayout() {
  const { signOut } = useAuth()

  return (
    <div className="lg:flex min-h-screen bg-[rgb(var(--bg))]">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Header (switcher + acción de sesión en móvil) */}
        <header className="sticky top-0 z-20 bg-surface/90 backdrop-blur border-b border-slate-200">
          <div className="h-16 px-4 lg:px-8 flex items-center justify-between gap-3 max-w-6xl mx-auto w-full">
            <RestaurantSwitcher />
            <button
              onClick={signOut}
              className="lg:hidden p-2 -mr-2 text-slate-400 hover:text-ocean-700 transition-colors"
              title="Cerrar sesión"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </header>

        {/* Contenido */}
        <main className="flex-1 w-full">
          <div className="max-w-6xl mx-auto px-4 lg:px-8 py-5 lg:py-8 pb-24 lg:pb-10">
            <Outlet />
          </div>
        </main>

        <BottomNav />
      </div>
    </div>
  )
}
