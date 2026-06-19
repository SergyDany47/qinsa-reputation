import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// El staff se autentica como `authenticated` normal; los privilegios reales
// los aplica la API FastAPI tras comprobar platform_admins.
export const supabase = createClient(url, anonKey)
