import type Echo from 'laravel-echo'
import { queryClient } from './queryClient'
import { session } from './api'

/**
 * Live updates over Laravel Reverb. The server broadcasts only *what* changed
 * (entity names); the client refetches those queries. Payloads stay tiny and
 * permissions are re-checked on the refetch, not trusted from the socket.
 *
 * Optional: when VITE_REVERB_APP_KEY is not set the app works the same,
 * relying on refetch-on-focus and a short staleTime.
 */
let echo: Echo<'reverb'> | null = null
let channelName: string | null = null

export async function connectRealtime(farmId: string) {
  const key = import.meta.env.VITE_REVERB_APP_KEY
  if (!key || !session.token) return
  if (!echo) {
    const [{ default: EchoCtor }, { default: Pusher }] = await Promise.all([import('laravel-echo'), import('pusher-js')])
    ;(window as unknown as { Pusher: unknown }).Pusher = Pusher
    echo = new EchoCtor({
      broadcaster: 'reverb',
      key,
      wsHost: import.meta.env.VITE_REVERB_HOST ?? window.location.hostname,
      wsPort: Number(import.meta.env.VITE_REVERB_PORT ?? 8080),
      wssPort: Number(import.meta.env.VITE_REVERB_PORT ?? 443),
      forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'http') === 'https',
      enabledTransports: ['ws', 'wss'],
      authEndpoint: '/api/broadcasting/auth',
      auth: { headers: { Authorization: `Bearer ${session.token}`, 'X-Farm-Id': farmId } },
    })
  }
  if (channelName) echo.leave(channelName)
  channelName = `farm.${farmId}`
  echo.private(channelName).listen('.changed', (e: { entities: string[] }) => {
    e.entities.forEach((entity) => queryClient.invalidateQueries({ queryKey: [entity] }))
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  })
}

export function disconnectRealtime() {
  if (echo && channelName) echo.leave(channelName)
  channelName = null
}
