import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from './navItems'

export default function BottomNav() {
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-slate-200 pb-safe">
      <div className="flex">
        {NAV_ITEMS.map(({ path, label, Icon, end }) => (
          <NavLink
            key={path}
            to={path}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 flex-1 text-[11px] font-medium tracking-wide transition-colors ${
                isActive ? 'text-ocean-700' : 'text-slate-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`px-4 py-1 rounded-full transition-colors ${isActive ? 'bg-lime-200' : ''}`}>
                  <Icon />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
