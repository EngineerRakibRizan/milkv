import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useRef } from 'react'
import { toast } from 'sonner'
import { send, toApiError, session, type ApiError } from '@/lib/api'
import { enqueue } from '@/lib/outbox'

type Method = 'post' | 'put' | 'patch' | 'delete'

type Options<TVars, TData> = {
  method?: Method
  url: string | ((vars: TVars) => string)
  /** Query keys to refetch after success (prefix match). */
  invalidate?: QueryKey[]
  /** Apply the change to the cache before the server answers. */
  optimistic?: { key: QueryKey; update: (old: unknown, vars: TVars) => unknown }
  /** Queue the write when offline instead of failing (for quick field entries). */
  offline?: boolean
  label?: string
  success?: string | ((data: TData) => string)
  onSuccess?: (data: TData, vars: TVars) => void
}

/**
 * One write path for the whole app: idempotent, optional optimistic update,
 * optional offline queueing, toast feedback, targeted invalidation.
 *
 * The Idempotency-Key is made once per payload and kept until that call
 * settles, so a double-tap or an automatic retry re-sends the same key and
 * the server answers with the first result, while different rows get their own.
 */
export function useApiMutation<TVars = unknown, TData = unknown>(o: Options<TVars, TData>) {
  const qc = useQueryClient()
  // One key per distinct payload, kept until that attempt settles.
  const keys = useRef(new Map<string, string>())

  return useMutation<TData, ApiError, TVars, { prev?: unknown; queued?: boolean }>({
    mutationFn: async (vars) => {
      const sig = JSON.stringify(vars ?? null)
      if (!keys.current.has(sig)) keys.current.set(sig, crypto.randomUUID())
      const key = keys.current.get(sig)!
      const url = typeof o.url === 'function' ? o.url(vars) : o.url
      const method = o.method ?? 'post'
      try {
        return await send<TData>(method, url, vars, { headers: { 'Idempotency-Key': key } })
      } catch (e) {
        const err = toApiError(e)
        if (err.offline && o.offline) {
          await enqueue({ key, method, url, body: vars, farmId: session.farmId, label: o.label ?? url, createdAt: Date.now() })
          return { queued: true } as TData
        }
        throw err
      }
    },
    onMutate: async (vars) => {
      if (!o.optimistic) return {}
      await qc.cancelQueries({ queryKey: o.optimistic.key })
      const prev = qc.getQueryData(o.optimistic.key)
      qc.setQueryData(o.optimistic.key, (old: unknown) => o.optimistic!.update(old, vars))
      return { prev }
    },
    onError: (err, _vars, ctx) => {
      if (o.optimistic && ctx && 'prev' in ctx) qc.setQueryData(o.optimistic.key, ctx.prev)
      toast.error(err.message)
    },
    onSuccess: (data, vars) => {
      const queued = (data as { queued?: boolean } | undefined)?.queued
      if (queued) toast.info('Saved offline — will sync when online')
      else if (o.success) toast.success(typeof o.success === 'function' ? o.success(data) : o.success)
      o.onSuccess?.(data, vars)
    },
    onSettled: (_d, _e, vars) => {
      keys.current.delete(JSON.stringify(vars ?? null))
      o.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }))
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
