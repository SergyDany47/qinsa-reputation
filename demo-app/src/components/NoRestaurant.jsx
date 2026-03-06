import { useNavigate } from 'react-router-dom'

export default function NoRestaurant({ label = 'estos datos' }) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-8 text-center">
      <div className="w-16 h-16 bg-qinsa-light rounded-2xl flex items-center justify-center">
        <svg className="w-8 h-8 text-qinsa-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
      </div>
      <div>
        <p className="font-semibold text-slate-700 text-base">Ningún restaurante seleccionado</p>
        <p className="text-sm text-slate-400 mt-1">Busca y selecciona un local para ver {label}</p>
      </div>
      <button
        onClick={() => navigate('/')}
        className="px-5 py-2.5 bg-qinsa-blue text-white rounded-xl text-sm font-semibold shadow-sm active:opacity-80"
      >
        Ir al buscador
      </button>
    </div>
  )
}
