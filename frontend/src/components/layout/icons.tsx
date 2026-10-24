/** Simple cow head glyph in the lucide line style (lucide has no cow icon). */
export function CowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5 6 3 4M19 6l2-2" />
      <path d="M6 7c0-1.7 1.3-3 3-3h6c1.7 0 3 1.3 3 3v5c0 1-.3 2-.9 2.8L16 16.5V18a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3v-1.5l-1.1-1.7A5 5 0 0 1 6 12z" />
      <path d="M3 9h3M18 9h3" />
      <circle cx="10.5" cy="17.5" r=".5" fill="currentColor" />
      <circle cx="13.5" cy="17.5" r=".5" fill="currentColor" />
      <path d="M9.5 10h.01M14.5 10h.01" />
    </svg>
  )
}
