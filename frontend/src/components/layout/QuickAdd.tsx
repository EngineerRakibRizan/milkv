import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Droplets, Egg, HandCoins, HeartPulse, Receipt, Truck, Wheat } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { BillModal, FeedIssueModal, PaymentModal } from '@/features/shared/forms'

/** The fastest path to the six most common daily entries, from any page. */
export function QuickAdd({ trigger }: { trigger: ReactNode }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<'payment' | 'expense' | 'feed' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const items = [
    { icon: Droplets, label: t('quick.milk', 'Record milk'), ok: can('milk.record'), go: () => navigate('/milk') },
    { icon: Truck, label: t('quick.delivery', 'Deliveries'), ok: can('deliveries.update'), go: () => navigate('/deliveries') },
    { icon: HandCoins, label: t('quick.payment', 'Customer payment'), ok: can('payments.create'), go: () => setModal('payment') },
    { icon: Receipt, label: t('quick.expense', 'Add expense'), ok: can('bills.create'), go: () => setModal('expense') },
    { icon: Wheat, label: t('quick.feed', 'Feed used'), ok: can('inventory.consume'), go: () => setModal('feed') },
    { icon: Egg, label: t('quick.eggs', 'Eggs & flock log'), ok: can('flocks.record'), go: () => navigate('/poultry') },
    { icon: HeartPulse, label: t('quick.treatment', 'Vet treatment'), ok: can('vet.create'), go: () => navigate('/vet?new=treatment') },
  ].filter((i) => i.ok)

  if (!items.length) return null
  return (
    <div className="relative" ref={ref}>
      <button className="btn-primary h-10 px-3 py-0 sm:px-4" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>{trigger}</button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
          {items.map((i) => (
            <button key={i.label} role="menuitem" className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-canvas"
              onClick={() => { setOpen(false); i.go() }}>
              <i.icon className="h-4 w-4 text-brand-700" />{i.label}
            </button>
          ))}
        </div>
      )}
      {modal === 'payment' && <PaymentModal open onClose={() => setModal(null)} />}
      {modal === 'expense' && <BillModal open onClose={() => setModal(null)} />}
      {modal === 'feed' && <FeedIssueModal open onClose={() => setModal(null)} />}
    </div>
  )
}
