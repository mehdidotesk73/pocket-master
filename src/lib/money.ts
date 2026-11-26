// Money and calendar-date helpers. Pure; no Vue, no storage.
//
// Money: amounts are stored as dollars rounded to cents, but every sum is done
// in integer cents so 0.1 + 0.2 never shows up on screen.
//
// Dates: a calendar date is a local 'YYYY-MM-DD' string. Arithmetic goes
// through a "day number" (days since 1970-01-01 in UTC), so time zones and DST
// can never move a date by one.

export type ISODate = string // 'YYYY-MM-DD'

/** Dollars → integer cents. */
export function toCents(dollars: number | undefined | null): number {
  if (dollars == null || !Number.isFinite(dollars)) return 0
  return Math.round(dollars * 100)
}

/** Integer (or fractional) cents → dollars rounded to the cent. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

/** Round a dollar value to cents. */
export function roundMoney(dollars: number): number {
  return fromCents(toCents(dollars))
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** $1,234.56, and negatives in parentheses: ($1,234.56). `sign` adds + to positives. */
export function fmtMoney(dollars: number, opts: { whole?: boolean; sign?: boolean } = {}): string {
  const v = Object.is(dollars, -0) ? 0 : dollars
  const s = (opts.whole ? usd0 : usd).format(Math.abs(v))
  if (v < 0 && Math.round(Math.abs(v) * 100) !== 0) return `(${s})`
  if (opts.sign && v > 0) return `+${s}`
  return s
}

/** A bare amount for a field that isn't being edited: 730.48, or (730.48) when negative. */
export function fmtPlain(dollars: number): string {
  const s = Math.abs(dollars).toFixed(2)
  return dollars < 0 && Math.round(Math.abs(dollars) * 100) !== 0 ? `(${s})` : s
}

/** Cents → formatted dollars. */
export function fmtCents(cents: number, opts: { whole?: boolean; sign?: boolean } = {}): string {
  return fmtMoney(fromCents(cents), opts)
}

/**
 * Parse what someone typed into a money field. Accepts "1,234.50", "$12", " 7 ",
 * "-3" and the accounting form "(730.48)" for negatives.
 * Returns null for empty or unparseable input.
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input == null) return null
  if (typeof input === 'number') return Number.isFinite(input) ? roundMoney(input) : null
  let cleaned = input.replace(/[$,\s]/g, '').replace(/[−–]/g, '-')
  const paren = /^\((.*)\)$/.exec(cleaned)
  if (paren) cleaned = `-${paren[1].replace(/^-/, '')}`
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? roundMoney(n) : null
}

// ---------------------------------------------------------------- dates

export function parseDate(d: ISODate): { y: number; m: number; day: number } {
  const [y, m, day] = d.split('-').map(Number)
  return { y, m, day }
}

export function isISODate(d: unknown): d is ISODate {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const { y, m, day } = parseDate(d)
  return m >= 1 && m <= 12 && day >= 1 && day <= daysInMonth(y, m)
}

/** Days since 1970-01-01 for a calendar date. */
export function dayNum(d: ISODate): number {
  const { y, m, day } = parseDate(d)
  return Date.UTC(y, m - 1, day) / 86_400_000
}

/** Inverse of dayNum. */
export function fromDayNum(n: number): ISODate {
  const dt = new Date(n * 86_400_000)
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

export function ymd(y: number, m: number, day: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDayNum(dayNum(d) + n)
}

/** Days in month m (1–12) of year y. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** A single increasing month index (y*12 + m-1) so months compare and step across years. */
export function monthIndex(d: ISODate): number {
  const { y, m } = parseDate(d)
  return y * 12 + (m - 1)
}

export function monthFromIndex(mi: number): { y: number; m: number } {
  return { y: Math.floor(mi / 12), m: (mi % 12) + 1 }
}

/** The date of `day` in the given month index, clamped to the month's last day. */
export function clampedDate(mi: number, day: number): ISODate {
  const { y, m } = monthFromIndex(mi)
  return ymd(y, m, Math.min(Math.max(1, Math.floor(day)), daysInMonth(y, m)))
}

/** Today as a local calendar date. */
export function today(now: Date = new Date()): ISODate {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Nov 26, 2026" (year dropped when `short`). */
export function fmtDate(d: ISODate, opts: { short?: boolean } = {}): string {
  const { y, m, day } = parseDate(d)
  return opts.short ? `${MONTHS[m - 1]} ${day}` : `${MONTHS[m - 1]} ${day}, ${y}`
}

export function monthLabel(mi: number): string {
  const { y, m } = monthFromIndex(mi)
  return m === 1 ? `Jan ’${String(y).slice(2)}` : MONTHS[m - 1]
}

// ---------------------------------------------------------------- date + time (records)
//
// A record's moment is a local date-time 'YYYY-MM-DDTHH:MM:SS' (no zone: it's
// "when on my calendar", like the dates above). Its date part drives every
// day-based calculation; the time only orders records and places them on charts.

export type LocalDateTime = string

export function isLocalDateTime(v: unknown): v is LocalDateTime {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v) && isISODate(v.slice(0, 10))
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** Now (or a given instant) as a local date-time. */
export function nowLocal(now: Date = new Date()): LocalDateTime {
  return `${today(now)}T${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`
}

/** An ISO instant (e.g. a savedAt timestamp) as a local date-time, or null. */
export function localFromISO(iso: string): LocalDateTime | null {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? nowLocal(new Date(t)) : null
}

/** Day number with the time of day as a fraction (for charts). */
export function atNum(at: LocalDateTime): number {
  const [h, m, s] = at.slice(11).split(':').map(Number)
  return dayNum(at.slice(0, 10)) + (h * 3600 + m * 60 + s) / 86_400
}

/** File-name-safe form: 2026-11-26T14-05-33. */
export function atKey(at: LocalDateTime): string {
  return at.replace(/:/g, '-')
}

/** "2:05 PM" */
export function fmtTime(at: LocalDateTime): string {
  const [h, m] = at.slice(11).split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${p2(m)} ${h < 12 ? 'AM' : 'PM'}`
}

/** "Nov 26, 2026, 2:05 PM" (year dropped when `short`). */
export function fmtDateTime(at: LocalDateTime, opts: { short?: boolean } = {}): string {
  return `${fmtDate(at.slice(0, 10), opts)}, ${fmtTime(at)}`
}
