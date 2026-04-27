import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Display helpers ─────────────────────────────────────────────────────────

/** "18:30:00" → "18:30" */
export function formatTime(t: string | null | undefined): string {
  if (!t) return '—'
  return t.slice(0, 5)
}

/** 3500 → "¥3,500"  |  null/0 → "¥ TBA" (no free shows in Japan) */
export function formatPrice(p: number | null | undefined): string {
  if (!p) return '¥ TBA'
  return `¥${p.toLocaleString()}`
}

/**
 * Parse a YYYY-MM-DD string into a UTC Date, avoiding any local-timezone shift.
 * new Date("2026-04-25T00:00:00+09:00") becomes 2026-04-24T15:00Z in UTC, so
 * getDate()/getDay() on a UTC server return the wrong day. Date.UTC avoids that.
 */
function parseDateUTC(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}

/** "2026-04-09" → "2026.04.09 (THU)" */
export function formatEventDate(d: string): string {
  const date = parseDateUTC(d)
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${y}.${m}.${day} (${days[date.getUTCDay()]})`
}

/** "2026-04-09" → "09 / 04 (THU)" short form for sidebar cards */
export function formatEventDateShort(d: string): string {
  const date = parseDateUTC(d)
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${day} / ${m} (${days[date.getUTCDay()]})`
}

/** "2026-04-09" → "Apr" (month abbreviation, timezone-safe) */
export function formatEventMonth(d: string): string {
  const date = parseDateUTC(d)
  return date.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })
}

/** Availability badge label */
export function availLabel(a: string): string {
  if (a === 'sold_out') return 'SOLD OUT'
  if (a === 'waitlist') return 'WAITLIST'
  return 'TICKETS AVAILABLE'
}

/** Tailwind bg/text classes for availability badge */
export function availClasses(a: string): string {
  if (a === 'sold_out') return 'bg-secondary-container text-on-secondary'
  if (a === 'waitlist') return 'bg-surface-container-highest text-primary border border-primary'
  return 'bg-primary-container text-on-primary-container'
}

/** Picsum image URL with a deterministic seed derived from a slug */
export function placeholderImage(slug: string, w = 600, h = 800): string {
  return `https://picsum.photos/seed/${slug}/${w}/${h}`
}
