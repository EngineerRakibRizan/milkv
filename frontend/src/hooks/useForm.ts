import { useCallback, useEffect, useState, type ChangeEvent } from 'react'

/**
 * Minimal controlled-form state. Validation is authoritative on the server;
 * its 422 field errors are shown inline via `errors`.
 */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial)
  const [errors, setErrors] = useState<Record<string, string[]>>({})

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => {
      if (!e[key as string]) return e
      const { [key as string]: _drop, ...rest } = e
      return rest
    })
  }, [])

  /** Spread onto <Input>/<Select>: value, onChange and error for a field. */
  const bind = (key: keyof T & string) => ({
    name: key,
    value: (values[key] ?? '') as string | number,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      set(key, (e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value) as T[typeof key]),
    error: errors[key],
  })

  const reset = (v: T = initial) => { setValues(v); setErrors({}) }

  /** Drops empty strings so optional fields are sent as absent, not "". */
  const payload = (): Partial<T> =>
    Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== undefined)) as Partial<T>

  return { values, set, bind, errors, setErrors, reset, payload }
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}
