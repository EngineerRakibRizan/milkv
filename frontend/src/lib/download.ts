import { http } from './api'

/** Downloads a file from the API with the auth headers and saves it under the server's filename. */
export async function downloadFrom(url: string, params?: Record<string, string>) {
  const res = await http.get(url, { params, responseType: 'blob', timeout: 300_000 })
  const cd = String(res.headers['content-disposition'] ?? '')
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? 'farmos-backup'
  const href = URL.createObjectURL(res.data as Blob)
  Object.assign(document.createElement('a'), { href, download: decodeURIComponent(name) }).click()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}
