import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/** Error de API con el código HTTP, para que la UI distinga 401/403/422/500. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(path, { method = 'GET', body } = {}) {
  // Adjunta el JWT del staff en cada llamada; la API valida + comprueba admin.
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    let detail
    try {
      detail = (await res.json()).detail
    } catch {
      detail = res.statusText
    }
    throw new ApiError(detail || `HTTP ${res.status}`, res.status)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  me: () => request('/admin/me'),
  listOrganizations: () => request('/admin/organizations'),
  createOrganization: (body) => request('/admin/organizations', { method: 'POST', body }),
  getOrganization: (id) => request(`/admin/organizations/${id}`),
  addMember: (orgId, body) =>
    request(`/admin/organizations/${orgId}/members`, { method: 'POST', body }),
  onboardRestaurant: (orgId, body) =>
    request(`/admin/organizations/${orgId}/restaurants`, { method: 'POST', body }),
  getSettings: () => request('/admin/settings'),
  updateSettings: (body) => request('/admin/settings', { method: 'PUT', body }),
}

/**
 * Consume el SSE de /admin/.../ingest con fetch+stream (EventSource no admite el
 * header Authorization). Llama onEvent(eventName, data) por cada evento.
 * Devuelve una función para abortar.
 */
export function streamIngest(restaurantId, { maxReviews = 10, generateReplies = true, model = 'gemini-2.5-flash' }, onEvent) {
  const controller = new AbortController()

  ;(async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const params = new URLSearchParams({
      max_reviews: String(maxReviews),
      generate_replies: String(generateReplies),
      model,
    })

    let res
    try {
      res = await fetch(`${API_URL}/admin/restaurants/${restaurantId}/ingest?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
    } catch (e) {
      if (!controller.signal.aborted) onEvent('message', { status: 'error', message: 'No se pudo conectar con la API' })
      return
    }

    if (!res.ok) {
      let detail
      try { detail = (await res.json()).detail } catch { detail = res.statusText }
      onEvent('message', { status: 'error', message: detail || `HTTP ${res.status}` })
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      let chunk
      try {
        chunk = await reader.read()
      } catch {
        break // abortado
      }
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })

      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() // resto incompleto

      for (const block of blocks) {
        let event = 'message'
        let dataStr = ''
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim()
        }
        if (dataStr) {
          try { onEvent(event, JSON.parse(dataStr)) } catch { /* ignora líneas no-JSON */ }
        }
      }
    }
  })()

  return () => controller.abort()
}
