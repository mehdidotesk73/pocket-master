// Plain-language text for projections (the items of a forecast): type labels,
// one-line summaries for the list, the live preview, and a colour per
// projection for the chart.
import { type Every, type ItemResult, type ProjectionFile, type ProjectionItem, type RecordWindow, type Recurring, describeSource } from '../../lib/finance'
import { fmtDate, fmtMoney, parseDate } from '../../lib/money'

export type UiType = 'recurring' | 'oneTime'
export const UI_TYPES: UiType[] = ['recurring', 'oneTime']
export const UI_INFO: Record<UiType, { label: string; help: string }> = {
  recurring: {
    label: 'Recurring',
    help: 'Repeats every so many days, weeks, months or years: an amount you type, or the average or rate of change of a line in your records.',
  },
  oneTime: { label: 'One-time', help: 'A fixed amount you type, on one date.' },
}
export const uiTypeOf = (item: ProjectionItem): UiType => item.kind

export const VALUE_MODES = [
  { id: 'fixed', label: 'Amount' },
  { id: 'average', label: 'Average' },
  { id: 'rate', label: 'Rate of change' },
] as const

export const WINDOW_MODES = [
  { id: 'all', label: 'All' },
  { id: 'last', label: 'Past days' },
  { id: 'lastRecords', label: 'Past records' },
  { id: 'between', label: 'Between' },
] as const

/** Chart colours for projections, from the look's palette (cycled). */
const PALETTE = ['var(--alert-note)', 'var(--alert-warning)', 'var(--alert-important)', 'var(--alert-tip)', 'var(--alert-caution)', 'var(--accent)']
export const colorFor = (index: number) => PALETTE[index % PALETTE.length]
export const START_COLOR = 'color-mix(in srgb, var(--mute) 45%, transparent)'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`

/** "every day", "every 2 weeks from Dec 4", "every month on the 15th", "every year on Apr 15". */
export function describeEvery(e: Every, start: string): string {
  const n = Math.max(1, Math.round(e.n))
  const { m, day } = parseDate(start)
  const unit = n === 1 ? e.unit : `${n} ${e.unit}s`
  switch (e.unit) {
    case 'day':
    case 'week':
      return `every ${unit}${start > '2001-01-01' ? ` from ${fmtDate(start, { short: true })}` : ''}`
    case 'month':
      return `every ${unit} on the ${day === 31 ? 'last day' : ordinal(day)}`
    case 'year':
      return `every ${unit} on ${MONTHS[m - 1]} ${day}`
  }
}

export function describeWindow(w: RecordWindow): string {
  switch (w.mode) {
    case 'all':
      return 'all records'
    case 'last':
      return `past ${w.days} days`
    case 'lastRecords':
      return `past ${w.count} records`
    case 'between':
      if (w.from && w.to) return `${fmtDate(w.from, { short: true })} – ${fmtDate(w.to, { short: true })}`
      if (w.from) return `from ${fmtDate(w.from, { short: true })}`
      if (w.to) return `to ${fmtDate(w.to, { short: true })}`
      return 'all records'
  }
}

export interface ResultText {
  text: string
  tone: 'pos' | 'neg' | 'warn' | ''
}

const toneOf = (v: number): ResultText['tone'] => (v > 0 ? 'pos' : v < 0 ? 'neg' : '')

/** What a recurring projection worked out from records comes to, in a sentence. */
export function describeResult(item: Recurring, res: ItemResult): ResultText | null {
  if (item.value.mode === 'fixed') return null
  if (res.value == null) return { text: res.reason ?? '', tone: 'warn' }
  const span = `from ${res.count} record${res.count === 1 ? '' : 's'}${res.days ? ` over ${res.days} days` : ''}`
  if (item.value.mode === 'rate') {
    return {
      text: `Changing ${fmtMoney(res.perDay ?? 0, { sign: true })} a day, so ${fmtMoney(res.value, { sign: true })} ${describeEvery(item.every, item.start)} (${span}).`,
      tone: toneOf(res.value),
    }
  }
  return { text: `Averages ${fmtMoney(res.value, { sign: true })}, added ${describeEvery(item.every, item.start)} (${span}).`, tone: toneOf(res.value) }
}

/** One-line summary for the list: amount per occurrence, then how and when. */
export function summarize(item: ProjectionItem, res: ItemResult | undefined, p: ProjectionFile): { amount: string; detail: string; tone: ResultText['tone'] } {
  if (item.kind === 'oneTime') return { amount: fmtMoney(item.amount, { sign: true }), detail: `on ${fmtDate(item.date)}`, tone: toneOf(item.amount) }
  const when = describeEvery(item.every, item.start)
  const v = item.value
  if (v.mode === 'fixed') {
    return { amount: fmtMoney(v.amount, { sign: true }), detail: `${when}${item.inRecord ? ' · in records until paid' : ''}`, tone: toneOf(v.amount) }
  }
  const how = `${v.mode === 'rate' ? 'rate' : 'average'} of ${describeSource(v.source, p.start)} · ${describeWindow(v.window)}`
  if (!res || res.value == null) return { amount: '—', detail: `${when} · ${how} · needs more records`, tone: 'warn' }
  return { amount: fmtMoney(res.value, { sign: true }), detail: `${when} · ${how}`, tone: toneOf(res.value) }
}
