import { createContext, useContext, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import BottomNav from './components/BottomNav'
import Home from './pages/Home'
import Resumen from './pages/Resumen'
import Empleados from './pages/Empleados'
import Resenas from './pages/Resenas'
import Distribucion from './pages/Distribucion'
import Onboarding from './pages/Onboarding'

export const RestaurantContext = createContext(null)
export const useRestaurant = () => useContext(RestaurantContext)

export default function App() {
  const [restaurant, setRestaurant] = useState(null)

  return (
    <RestaurantContext.Provider value={{ restaurant, setRestaurant }}>
      <BrowserRouter>
        {/* max-w-[430px] centra la app en tablet/desktop manteniendo ancho iPhone */}
        <div className="max-w-[430px] mx-auto h-screen flex flex-col bg-slate-50 overflow-hidden shadow-2xl">
          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/resumen" element={<Resumen />} />
              <Route path="/empleados" element={<Empleados />} />
              <Route path="/resenas" element={<Resenas />} />
              <Route path="/distribucion" element={<Distribucion />} />
              <Route path="/onboarding" element={<Onboarding />} />
            </Routes>
          </main>
          <BottomNav />
        </div>
      </BrowserRouter>
    </RestaurantContext.Provider>
  )
}
