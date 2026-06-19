import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

const RestaurantContext = createContext(null)
export const useRestaurant = () => useContext(RestaurantContext)

const LS_KEY = 'qinsa.selectedRestaurant'
const SELECT = 'id,name,neighborhood,city,google_rating,review_count,response_rate,profile_status'

/**
 * Carga los restaurantes visibles para el usuario autenticado (RLS filtra por
 * organización) y gestiona el local seleccionado. Auto-selecciona si solo hay
 * uno; recuerda la última selección entre sesiones.
 */
export function RestaurantProvider({ children }) {
  const { session } = useAuth()
  const [restaurants, setRestaurants] = useState([])
  const [restaurant, setRestaurantState] = useState(null)
  const [loading, setLoading] = useState(true)

  const setRestaurant = (r) => {
    setRestaurantState(r)
    if (r?.id) localStorage.setItem(LS_KEY, r.id)
  }

  useEffect(() => {
    if (!session) {
      setRestaurants([])
      setRestaurantState(null)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    supabase
      .from('restaurants')
      .select(SELECT)
      .order('name')
      .then(({ data }) => {
        if (!active) return
        const list = data || []
        setRestaurants(list)
        // Restaura la selección previa, o auto-selecciona el primero
        const savedId = localStorage.getItem(LS_KEY)
        const match = list.find((r) => r.id === savedId) || list[0] || null
        setRestaurantState(match)
        if (match?.id) localStorage.setItem(LS_KEY, match.id)
        setLoading(false)
      })
    return () => { active = false }
  }, [session])

  return (
    <RestaurantContext.Provider
      value={{ restaurants, restaurant, setRestaurant, loading }}
    >
      {children}
    </RestaurantContext.Provider>
  )
}
