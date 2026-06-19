import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { RestaurantProvider } from './lib/RestaurantContext'
import AppLayout from './components/AppLayout'
import Spinner from './components/Spinner'
import Login from './pages/Login'
import Resumen from './pages/Resumen'
import Empleados from './pages/Empleados'
import Resenas from './pages/Resenas'

/** Bloquea las rutas privadas: sin sesión → redirige a /login conservando el destino. */
function RequireAuth({ children }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <RestaurantProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
              <Route index element={<Resumen />} />
              <Route path="equipo" element={<Empleados />} />
              <Route path="resenas" element={<Resenas />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </RestaurantProvider>
    </AuthProvider>
  )
}
