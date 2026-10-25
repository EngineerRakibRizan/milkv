import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { AppShell } from './components/layout/AppShell'
import { LoginPage, REGISTRATION_OPEN, RegisterPage } from './features/auth/AuthPages'
import { Spinner } from './components/ui'

// Route-level code splitting: each module downloads only when first opened.
const Dashboard = lazy(() => import('./features/dashboard/DashboardPage'))
const Animals = lazy(() => import('./features/livestock/AnimalsPage'))
const AnimalProfile = lazy(() => import('./features/livestock/AnimalProfilePage'))
const Poultry = lazy(() => import('./features/poultry/PoultryPage'))
const FlockDetail = lazy(() => import('./features/poultry/FlockPage'))
const Inventory = lazy(() => import('./features/inventory/InventoryPage'))
const Milk = lazy(() => import('./features/milk/MilkPage'))
const Deliveries = lazy(() => import('./features/deliveries/DeliveriesPage'))
const Customers = lazy(() => import('./features/customers/CustomersPage'))
const CustomerDetail = lazy(() => import('./features/customers/CustomerPage'))
const Vet = lazy(() => import('./features/vet/VetPage'))
const Income = lazy(() => import('./features/finance/IncomePage'))
const Expenses = lazy(() => import('./features/finance/ExpensesPage'))
const Suppliers = lazy(() => import('./features/finance/SuppliersPage'))
const Reports = lazy(() => import('./features/reports/ReportsPage'))
const Employees = lazy(() => import('./features/team/EmployeesPage'))
const Tasks = lazy(() => import('./features/team/TasksPage'))
const Notifications = lazy(() => import('./features/team/NotificationsPage'))
const Settings = lazy(() => import('./features/settings/SettingsPage'))
const Search = lazy(() => import('./features/search/SearchPage'))
const Leads = lazy(() => import('./features/leads/LeadsPage'))
const Account = lazy(() => import('./features/account/AccountPage'))
const Landing = lazy(() => import('./features/landing/LandingPage'))

const PageLoading = <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-brand-700" /></div>

export default function App() {
  const { user, ready } = useAuth()

  if (!ready) {
    return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-brand-700" /></div>
  }
  // The public landing page: the site root for visitors, /order for everyone.
  const landing = <Suspense fallback={PageLoading}><Landing /></Suspense>

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={landing} />
        <Route path="/order" element={landing} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={REGISTRATION_OPEN ? <RegisterPage /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  return (
    <Routes>
      <Route path="order" element={landing} />
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="livestock" element={<Animals />} />
        <Route path="livestock/:id" element={<AnimalProfile />} />
        <Route path="poultry" element={<Poultry />} />
        <Route path="poultry/:id" element={<FlockDetail />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="milk" element={<Milk />} />
        <Route path="deliveries" element={<Deliveries />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="vet" element={<Vet />} />
        <Route path="income" element={<Income />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="reports" element={<Reports />} />
        <Route path="employees" element={<Employees />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
        <Route path="search" element={<Search />} />
        <Route path="leads" element={<Leads />} />
        <Route path="account" element={<Account />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="register" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
