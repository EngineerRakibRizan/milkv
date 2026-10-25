import { useEffect, useState } from 'react'

/**
 * "Install app" support. Chrome/Edge/Android fire `beforeinstallprompt` once, early,
 * so it is captured at startup (this module is imported by main.tsx) and replayed
 * when the user taps Install. iPhone has no install API: we show the manual steps.
 */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallPrompt | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault() // keep it for our own button instead of the browser mini-bar
  deferred = e as InstallPrompt
  notify()
})
window.addEventListener('appinstalled', () => { deferred = null; notify() })

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function usePwaInstall() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  const standalone = isStandalone()

  return {
    installed: standalone,
    /** Native one-tap install is available (Android, desktop Chrome/Edge). */
    canPrompt: !standalone && deferred !== null,
    /** iPhone/iPad in Safari: needs Share → Add to Home Screen. */
    needsIosSteps: !standalone && isIos(),
    install: async () => {
      if (!deferred) return false
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      deferred = null
      notify()
      return outcome === 'accepted'
    },
  }
}
