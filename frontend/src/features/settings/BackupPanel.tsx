import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Archive, CheckCircle2, Database, DownloadCloud, FileSpreadsheet, HardDriveDownload, Server, UploadCloud } from 'lucide-react'
import { get, http, send, toApiError } from '@/lib/api'
import { downloadFrom } from '@/lib/download'
import { useAuth } from '@/lib/auth'
import { dateTime, num } from '@/lib/format'
import { Card, Confirm, Empty, Spinner } from '@/components/ui'

type Stored = { name: string; size: number; created_at: string }
type Format = 'full' | 'sql' | 'csv'

const kb = (b: number) => (b > 1024 * 1024 ? `${num(b / 1024 / 1024, 1)} MB` : `${num(b / 1024, 0)} KB`)

export function BackupPanel() {
  const { t } = useTranslation()
  const { switchFarm } = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<Format | 'store' | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [importing, setImporting] = useState(false)
  const [restored, setRestored] = useState<{ farm_id: number; name: string; counts: Record<string, number>; files: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const stored = useQuery({ queryKey: ['backups'], queryFn: () => get<{ backups: Stored[]; keep_days: number }>('/backup/stored') })

  const download = async (format: Format) => {
    setBusy(format)
    try {
      await downloadFrom('/backup/download', { format })
      toast.success(t('backup.downloaded'))
    } catch (e) {
      toast.error(toApiError(e).message)
    } finally {
      setBusy(null)
    }
  }

  const createNow = async () => {
    setBusy('store')
    try {
      await send('post', '/backup/stored')
      await qc.invalidateQueries({ queryKey: ['backups'] })
      toast.success(t('backup.created'))
    } catch (e) {
      toast.error(toApiError(e).message)
    } finally {
      setBusy(null)
    }
  }

  const runImport = async () => {
    if (!file) return
    setImporting(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const { data } = await http.post('/backup/import', body, { timeout: 600_000 })
      setRestored(data)
      setFile(null)
      await qc.invalidateQueries({ queryKey: ['me'] })
      toast.success(t('backup.restoredToast'))
    } catch (e) {
      const err = toApiError(e)
      toast.error(err.errors.file?.[0] ?? err.message)
    } finally {
      setImporting(false)
    }
  }

  const formats: Array<{ f: Format; icon: typeof Archive; title: string; text: string; ext: string; primary?: boolean }> = [
    { f: 'full', icon: Archive, title: t('backup.fullTitle'), text: t('backup.fullText'), ext: '.farmos.zip', primary: true },
    { f: 'csv', icon: FileSpreadsheet, title: t('backup.csvTitle'), text: t('backup.csvText'), ext: '.csv.zip' },
    { f: 'sql', icon: Database, title: t('backup.sqlTitle'), text: t('backup.sqlText'), ext: '.sql' },
  ]

  return (
    <div className="max-w-4xl space-y-4">
      <Card title={<span className="flex items-center gap-2"><DownloadCloud className="h-4 w-4 text-brand-700" />{t('backup.downloadTitle')}</span>}>
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {formats.map(({ f, icon: Icon, title, text, ext, primary }) => (
            <div key={f} className={`flex flex-col rounded-xl border p-4 ${primary ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-900/10' : 'border-line'}`}>
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-brand-700" /><p className="font-semibold">{title}</p>
              </div>
              <p className="mt-1 flex-1 text-sm text-muted">{text}</p>
              <p className="mt-2 font-mono text-xs text-muted">{ext}</p>
              <button className={`${primary ? 'btn-primary' : 'btn-secondary'} mt-3`} disabled={!!busy} onClick={() => download(f)}>
                {busy === f ? <Spinner /> : <HardDriveDownload className="h-4 w-4" />}{t('backup.download')}
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Server className="h-4 w-4 text-brand-700" />{t('backup.serverTitle')}</span>}
        actions={<button className="btn-secondary py-1.5" disabled={!!busy} onClick={createNow}>{busy === 'store' && <Spinner />}{t('backup.createNow')}</button>}>
        <p className="border-b border-line px-4 py-3 text-sm text-muted">{t('backup.serverText', { days: stored.data?.keep_days ?? 14 })}</p>
        {stored.data?.backups.length ? (
          <ul className="divide-y divide-line">
            {stored.data.backups.map((b) => (
              <li key={b.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">{dateTime(b.created_at)}</p><p className="truncate text-xs text-muted">{b.name} · {kb(b.size)}</p></div>
                <button className="btn-ghost py-1.5" onClick={() => downloadFrom(`/backup/stored/${encodeURIComponent(b.name)}`).catch((e) => toast.error(toApiError(e).message))}>
                  <HardDriveDownload className="h-4 w-4" />{t('backup.download')}
                </button>
              </li>
            ))}
          </ul>
        ) : <Empty title={t('backup.noneYet')} />}
      </Card>

      <Card title={<span className="flex items-center gap-2"><UploadCloud className="h-4 w-4 text-brand-700" />{t('backup.importTitle')}</span>}>
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted">{t('backup.importText')}</p>
          {restored ? (
            <div className="rounded-xl border border-brand-600 bg-brand-50 p-4 dark:bg-brand-900/20">
              <p className="flex items-center gap-2 font-semibold text-brand-800 dark:text-brand-500"><CheckCircle2 className="h-5 w-5" />{t('backup.restored', { name: restored.name })}</p>
              <p className="mt-1 text-sm text-muted">{t('backup.restoredCounts', { rows: num(Object.values(restored.counts).reduce((a, b) => a + b, 0), 0), files: restored.files })}</p>
              <button className="btn-primary mt-3" onClick={() => switchFarm(restored.farm_id)}>{t('backup.openRestored')}</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <input ref={input} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button className="btn-secondary" onClick={() => input.current?.click()}><UploadCloud className="h-4 w-4" />{t('backup.chooseFile')}</button>
              {file && <span className="text-sm">{file.name} · {kb(file.size)}</span>}
              {file && <button className="btn-primary" disabled={importing} onClick={() => setConfirming(true)}>{importing && <Spinner />}{importing ? t('backup.restoring') : t('backup.restore')}</button>}
            </div>
          )}
          <p className="text-xs text-muted">{t('backup.importNote')}</p>
        </div>
      </Card>

      <Confirm open={confirming} onClose={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); runImport() }} title={t('backup.confirmTitle')} message={t('backup.confirmText', { name: file?.name ?? '' })} />
    </div>
  )
}
