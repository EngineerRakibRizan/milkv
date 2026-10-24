import { get as idbGet, set as idbSet } from 'idb-keyval'
import { http } from './api'
import { queryClient } from './queryClient'

/**
 * Offline outbox. A write that fails for lack of network is stored with its
 * Idempotency-Key and replayed in order when the connection returns. The
 * server deduplicates on that key, so a replay can never double-post.
 */
export type OutboxItem = {
  key: string
  method: 'post' | 'put' | 'patch' | 'delete'
  url: string
  body?: unknown
  farmId: string | null
  label: string
  createdAt: number
}

const STORE = 'farmos.outbox'
const listeners = new Set<(n: number) => void>()
let flushing = false

async function read(): Promise<OutboxItem[]> { return (await idbGet<OutboxItem[]>(STORE)) ?? [] }
async function write(items: OutboxItem[]) {
  await idbSet(STORE, items)
  listeners.forEach((l) => l(items.length))
}

export async function enqueue(item: OutboxItem) { await write([...(await read()), item]) }

export function onOutboxChange(fn: (n: number) => void) {
  listeners.add(fn)
  read().then((i) => fn(i.length))
  return () => { listeners.delete(fn) }
}

export async function flushOutbox() {
  if (flushing || !navigator.onLine) return
  flushing = true
  try {
    let items = await read()
    while (items.length) {
      const item = items[0]
      try {
        await http.request({
          method: item.method, url: item.url, data: item.body,
          headers: { 'Idempotency-Key': item.key, ...(item.farmId ? { 'X-Farm-Id': item.farmId } : {}) },
        })
      } catch (e: unknown) {
        const status = (e as { response?: { status: number } }).response?.status
        if (!status) break // still offline: keep the queue as is
        // A 4xx rejection will never succeed on retry: drop it so the queue keeps moving.
        console.warn('Outbox item rejected', item.label, status)
      }
      items = items.slice(1)
      await write(items)
    }
    queryClient.invalidateQueries()
  } finally {
    flushing = false
  }
}

window.addEventListener('online', () => { flushOutbox() })
