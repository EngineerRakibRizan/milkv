import { QueryCache, QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get, set, del } from 'idb-keyval'
import { toast } from 'sonner'
import { toApiError } from './api'

export const queryClient = new QueryClient({
  // A failed load is never shown as an empty list: surface it once, keep cached data on screen.
  queryCache: new QueryCache({
    onError: (err, query) => {
      const e = toApiError(err)
      if (e.status === 401 || (e.offline && query.state.data !== undefined)) return
      toast.error(e.offline ? e.message : `Could not load data: ${e.message}`, { id: 'load-error' })
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,         // realtime events invalidate sooner when data changes
      gcTime: 1000 * 60 * 60 * 24, // keep for a day so the persisted cache is useful
      retry: (count, err: unknown) => !(err as { response?: unknown }).response && count < 2,
      refetchOnWindowFocus: true,
    },
  },
})

// Persist the cache to IndexedDB so the app paints instantly when it is reopened.
export const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: 'farmos.cache',
  throttleTime: 1000,
})
