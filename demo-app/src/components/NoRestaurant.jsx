import { EmptyState } from './ui'

export default function NoRestaurant() {
  return (
    <EmptyState
      title="No hay ningún local asignado a tu cuenta"
      subtitle="Si crees que es un error, contacta con tu gestor de Qinsalabs para que vincule tu restaurante."
      icon={
        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" /><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" />
        </svg>
      }
    />
  )
}
