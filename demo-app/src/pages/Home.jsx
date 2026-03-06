import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRestaurant } from '../App'
import Spinner from '../components/Spinner'

function StarFilled({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  )
}

function RestaurantCard({ r, onSelect, isSelected }) {
  return (
    <button
      onClick={() => onSelect(r)}
      className={`w-full text-left px-4 py-4 bg-white rounded-2xl shadow-sm border transition-all active:scale-[0.98] ${
        isSelected ? 'border-qinsa-green ring-1 ring-qinsa-green' : 'border-slate-100'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 truncate">{r.name}</p>
          {r.neighborhood && (
            <p className="text-xs text-slate-400 mt-0.5">{r.neighborhood}{r.city ? `, ${r.city}` : ''}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            {r.google_rating && (
              <span className="flex items-center gap-1 text-sm font-semibold text-amber-500">
                <StarFilled />
                {Number(r.google_rating).toFixed(1)}
              </span>
            )}
            {r.review_count && (
              <span className="text-xs text-slate-400">{r.review_count.toLocaleString('es-ES')} reseñas</span>
            )}
            {r.response_rate != null && (
              <span className="text-xs text-slate-400">
                {Math.round(r.response_rate)}% resp.
              </span>
            )}
          </div>
        </div>
        <div className={`shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${
          isSelected ? 'bg-qinsa-green border-qinsa-green' : 'border-slate-200'
        }`}>
          {isSelected && (
            <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      </div>
      {isSelected && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-qinsa-green font-medium">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          Seleccionado — toca otra pestaña para ver los insights
        </div>
      )}
    </button>
  )
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const { restaurant, setRestaurant } = useRestaurant()
  const navigate = useNavigate()
  const debounceRef = useRef(null)

  // Carga todos los restaurantes al montar
  useEffect(() => {
    loadAll()
  }, [])

  // Debounce del buscador
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (query.trim().length > 1) {
        search(query.trim())
      } else if (query.trim().length === 0) {
        loadAll()
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  const loadAll = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('restaurants')
      .select('id,name,neighborhood,city,google_rating,review_count,response_rate,profile_status')
      .order('name')
      .limit(50)
    setResults(data || [])
    setLoading(false)
  }

  const search = async (q) => {
    setLoading(true)
    const { data } = await supabase
      .from('restaurants')
      .select('id,name,neighborhood,city,google_rating,review_count,response_rate,profile_status')
      .ilike('name', `%${q}%`)
      .limit(20)
    setResults(data || [])
    setLoading(false)
  }

  const selectRestaurant = (r) => {
    setRestaurant(r)
    navigate('/resumen')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-qinsa-blue px-4 pt-10 pb-5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 bg-qinsa-green rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-xs">Q</span>
          </div>
          <span className="text-white/60 text-xs font-medium tracking-widest uppercase">Qinsa Reputation</span>
        </div>
        <h1 className="text-white text-xl font-bold">Selecciona un restaurante</h1>
        <p className="text-white/50 text-xs mt-0.5">Busca el local para comenzar la demo</p>

        {/* Search */}
        <div className="relative mt-4">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Nombre del restaurante..."
            className="w-full pl-9 pr-4 py-3 bg-white rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-qinsa-green"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <Spinner />
        ) : results.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="font-medium">Sin resultados</p>
            <p className="text-sm mt-1">Prueba con otro nombre</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide px-1">
              {results.length} {results.length === 1 ? 'restaurante' : 'restaurantes'}
            </p>
            {results.map(r => (
              <RestaurantCard
                key={r.id}
                r={r}
                onSelect={selectRestaurant}
                isSelected={restaurant?.id === r.id}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
