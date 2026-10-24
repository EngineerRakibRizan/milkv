import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get, send, session } from './api'
import { queryClient } from './queryClient'
import { del } from 'idb-keyval'
import i18n from './i18n'
import { setFormatSettings } from './format'
import { connectRealtime, disconnectRealtime } from './realtime'

export type FarmSummary = {
  id: number; name: string; role: string; currency: string; locale: string; timezone: string
  default_milk_price: string; abilities: string[]
}
export type Session = { token?: string; user: { id: number; name: string; email: string; locale: string }; farms: FarmSummary[] }

type AuthCtx = {
  user: Session['user'] | null
  farms: FarmSummary[]
  farm: FarmSummary | null
  ready: boolean
  can: (ability: string) => boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: Record<string, string>) => Promise<void>
  logout: () => Promise<void>
  switchFarm: (id: number) => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(session.token)
  const [farmId, setFarmId] = useState(session.farmId)

  // The session itself is cached and persisted, so a reopened app is usable before the network answers.
  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => get<Session>('/auth/me'),
    enabled: !!token,
    staleTime: 5 * 60_000,
  })

  const farms = me.data?.farms ?? []
  const farm = farms.find((f) => String(f.id) === farmId) ?? farms[0] ?? null

  useEffect(() => {
    if (!farm) return
    if (session.farmId !== String(farm.id)) { session.farmId = String(farm.id); setFarmId(String(farm.id)) }
    setFormatSettings(farm.currency, i18n.language)
    connectRealtime(String(farm.id))
  }, [farm])

  useEffect(() => {
    const onLogout = () => { setToken(null); queryClient.clear() }
    window.addEventListener('farmos:logout', onLogout)
    return () => window.removeEventListener('farmos:logout', onLogout)
  }, [])

  const adopt = useCallback((s: Session) => {
    session.token = s.token ?? null
    queryClient.setQueryData(['me', s.token], s)
    if (s.farms[0] && !s.farms.some((f) => String(f.id) === session.farmId)) session.farmId = String(s.farms[0].id)
    setFarmId(session.farmId)
    setToken(s.token ?? null)
  }, [])

  const value = useMemo<AuthCtx>(() => ({
    user: me.data?.user ?? null,
    farms,
    farm,
    ready: !token || me.isFetched || !!me.data,
    can: (ability) => {
      const a = farm?.abilities ?? []
      return a.includes('*') || a.includes(ability) || a.includes(ability.split('.')[0] + '.*')
    },
    login: async (email, password) => adopt(await send<Session>('post', '/auth/login', { email, password })),
    register: async (data) => adopt(await send<Session>('post', '/auth/register', data)),
    logout: async () => {
      try { await send('post', '/auth/logout') } catch { /* token may already be gone */ }
      disconnectRealtime()
      session.token = null
      session.farmId = null
      queryClient.clear()
      await del('farmos.cache')
      setToken(null)
    },
    switchFarm: (id) => {
      session.farmId = String(id)
      setFarmId(String(id))
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    },
  }), [me.data, me.isFetched, farms, farm, token, adopt])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
