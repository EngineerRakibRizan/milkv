import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Share, SquarePlus, Smartphone } from 'lucide-react'
import { usePwaInstall } from '@/lib/pwa'
import { Modal } from '@/components/ui'

/** Header button: one-tap install where supported, step-by-step help on iPhone. Hidden once installed. */
export function InstallAppButton() {
  const { t } = useTranslation()
  const pwa = usePwaInstall()
  const [help, setHelp] = useState(false)
  if (pwa.installed || (!pwa.canPrompt && !pwa.needsIosSteps)) return null
  return (
    <>
      <button className="btn-secondary h-10 px-2.5 py-0 sm:px-3" title={t('pwa.install')} aria-label={t('pwa.install')}
        onClick={() => (pwa.canPrompt ? pwa.install() : setHelp(true))}>
        <Download className="h-4 w-4" /><span className="hidden md:inline">{t('pwa.install')}</span>
      </button>
      {help && <IosSteps onClose={() => setHelp(false)} />}
    </>
  )
}

/** Card for the account page: explains installing on any phone. */
export function InstallAppCard() {
  const { t } = useTranslation()
  const pwa = usePwaInstall()
  const [help, setHelp] = useState(false)
  return (
    <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <img src="/icons/icon-96.png" alt="" className="h-12 w-12 rounded-xl" />
        <div>
          <p className="font-semibold">{t('pwa.cardTitle')}</p>
          <p className="text-sm text-muted">{pwa.installed ? t('pwa.installedText') : t('pwa.cardText')}</p>
        </div>
      </div>
      {!pwa.installed && (
        pwa.canPrompt
          ? <button className="btn-primary" onClick={() => pwa.install()}><Download className="h-4 w-4" />{t('pwa.install')}</button>
          : <button className="btn-secondary" onClick={() => setHelp(true)}><Smartphone className="h-4 w-4" />{t('pwa.howTo')}</button>
      )}
      {help && <IosSteps onClose={() => setHelp(false)} all />}
    </div>
  )
}

function IosSteps({ onClose, all }: { onClose: () => void; all?: boolean }) {
  const { t } = useTranslation()
  return (
    <Modal open size="sm" onClose={onClose} title={t('pwa.install')} footer={<button className="btn-primary" onClick={onClose}>{t('common.confirm')}</button>}>
      <p className="mb-2 text-sm font-semibold">iPhone / iPad (Safari)</p>
      <ol className="space-y-3 text-sm">
        <li className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Share className="h-4 w-4" /></span>{t('pwa.ios1')}</li>
        <li className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><SquarePlus className="h-4 w-4" /></span>{t('pwa.ios2')}</li>
        <li className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Download className="h-4 w-4" /></span>{t('pwa.ios3')}</li>
      </ol>
      {all && <>
        <p className="mb-2 mt-5 text-sm font-semibold">Android (Chrome)</p>
        <p className="text-sm text-muted">{t('pwa.android')}</p>
      </>}
    </Modal>
  )
}
