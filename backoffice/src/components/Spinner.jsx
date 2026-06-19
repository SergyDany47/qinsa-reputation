export default function Spinner({ className = 'w-6 h-6' }) {
  return (
    <div className="flex items-center justify-center py-8">
      <div
        className={`${className} border-2 border-slate-200 border-t-qinsa-green rounded-full animate-spin`}
      />
    </div>
  )
}
