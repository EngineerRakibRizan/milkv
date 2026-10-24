import { useQuery } from '@tanstack/react-query'
import { get, type Paginated } from './api'

/** Small reference lists used by selects across the app; long staleTime, refreshed by realtime events. */
const opts = { staleTime: 5 * 60_000 }

export type Animal = {
  id: number; tag: string; name: string | null; type: string; breed: string | null; gender: string; status: string
  lactation_status: string | null; health_status: string; reproductive_status: string | null; birth_date: string | null
  acquired_at: string | null; acquisition: string; purchase_price: string; current_value: string; color: string | null
  mother_id: number | null; father_info: string | null; feed_group: string | null; weight: string | null; notes: string | null
  age_months: number | null; sale_price: string | null; status_date: string | null; archived: boolean
}
export type Flock = { id: number; code: string; name: string; species: string; breed: string | null; purpose: string; started_at: string
  initial_count: number; current_count: number; cost: string; location: string | null; status: string; notes: string | null; age_weeks: number | null
  eggs_7d?: number; deaths_7d?: number }
export type FeedItem = { id: number; sku: string; name: string; category: string; unit: string; stock: string; min_stock: string
  stock_value: string; avg_cost: string; low: boolean; supplier_id: number | null; location: string | null; expires_at: string | null; notes: string | null }
export type Customer = { id: number; code: string; name: string; phone: string | null; alt_phone: string | null; address: string | null
  area: string | null; type: string; default_qty: string; price: string | null; schedule: string; payment_terms: string
  employee_id: number | null; status: string; balance: string; joined_at: string | null; notes: string | null }
export type Supplier = { id: number; name: string; phone: string | null; address: string | null; type: string | null; balance: string; notes: string | null }
export type Employee = { id: number; code: string; name: string; phone: string | null; title: string | null; salary: string; status: string
  address: string | null; joined_at: string | null; emergency_contact: string | null; route: string | null; user_id: number | null; notes: string | null }
export type Account = { id: number; key: string; code: string; name: string; type: string; section: string; is_system: boolean }

export const useAnimals = (params: Record<string, unknown> = {}) =>
  useQuery({ queryKey: ['animals', 'lookup', params], queryFn: () => get<Paginated<Animal>>('/animals', { per_page: 100, ...params }).then((r) => r.data), ...opts })
export const useFlocks = () => useQuery({ queryKey: ['flocks', 'lookup'], queryFn: () => get<Flock[]>('/flocks'), ...opts })
export const useFeedItems = () => useQuery({ queryKey: ['inventory', 'lookup'], queryFn: () => get<{ data: FeedItem[] }>('/inventory').then((r) => r.data), ...opts })
export const useCustomers = () =>
  useQuery({ queryKey: ['customers', 'lookup'], queryFn: () => get<Paginated<Customer>>('/customers', { per_page: 100, status: 'active' }).then((r) => r.data), ...opts })
export const useSuppliers = () => useQuery({ queryKey: ['suppliers', 'lookup'], queryFn: () => get<Supplier[]>('/suppliers'), ...opts })
export const useEmployees = () => useQuery({ queryKey: ['employees', 'lookup'], queryFn: () => get<Employee[]>('/employees', { status: 'active' }), ...opts })
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => get<Account[]>('/accounts'), staleTime: 30 * 60_000 })

export const PAYMENT_METHODS = ['cash', 'bkash', 'nagad', 'rocket', 'bank', 'other']
export const animalLabel = (a: { tag: string; name: string | null }) => (a.name ? `${a.tag} · ${a.name}` : a.tag)
