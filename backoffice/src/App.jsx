import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Layout from './components/Layout'
import Spinner from './components/Spinner'
import Login from './pages/Login'
import Organizations from './pages/Organizations'
import OrganizationDetail from './pages/OrganizationDetail'
import Settings from './pages/Settings'

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

function ProtectedApp() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Organizations />} />
        <Route path="/org/:id" element={<OrganizationDetail />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<RequireAuth><ProtectedApp /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
