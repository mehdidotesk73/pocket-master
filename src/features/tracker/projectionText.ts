// Plain-language text for projections (the items of a forecast): type labels,
// one-line summaries for the list, the live preview, and a colour per
// projection for the chart.
import {
  type Every,
  type ItemResult,
  type Projection,
  type ProjectionFile,
  type ProjectionItem,
  type RecordWindow,
  type Recurring,
  LEFT_SOURCE,
  MIN_RATE_DAYS,
  describeSource,
  periodDays,
  targetOf,
} from '../../lib/finance'
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

/** Does the forecast hold anything typed in as money coming in (pay)? */
export function hasIncome(p: Pick<ProjectionFile, 'items'>, except?: string): boolean {
  return p.items.some(
    (i) => i.id !== except && (i.kind === 'oneTime' ? i.amount > 0 : i.value.mode === 'fixed' && i.value.amount > 0),
  )
}

/** A rate of net equity with no income listed is income and spending combined. */
export const isCombinedDrift = (item: ProjectionItem, p: Pick<ProjectionFile, 'items'>) =>
  item.kind === 'recurring' && item.value.mode === 'rate' && item.value.source === LEFT_SOURCE && !hasIncome(p, item.id)

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const possessive = (s: string) => `${s}’s`
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface ReadBack {
  /** The projection's settings as one sentence. */
  sentence: string
  /** What it comes to by the end of the forecast. */
  total: string
  /** Its effect on the line it changes. */
  line: string
  /** Where a worked-out value comes from. */
  basis: string
  warnings: string[]
  tone: ResultText['tone']
}

/**
 * The editor's live readback: the settings as a sentence, what they add up to by
 * the forecast's end, the line they move, and anything that looks unintended.
 */
export function readBack(item: ProjectionItem, f: Projection, p: ProjectionFile): ReadBack {
  const target = targetOf(item)
  const to = target ? `to ${target}` : 'to net equity only'
  const run = f.contributions[item.id] ?? []
  const total = run.length ? run[run.length - 1] : 0
  const times = run.filter((v, i) => Math.abs(v - (i ? run[i - 1] : 0)) >= 0.005).length
  const end = fmtDate(f.end.date)
  const warnings: string[] = []
  let sentence = ''
  let basis = ''
  let tone: ResultText['tone'] = toneOf(total)

  if (item.kind === 'oneTime') {
    sentence = `On ${fmtDate(item.date)}, add ${fmtMoney(item.amount, { sign: true })} ${to}.`
    if (item.date <= f.start.date || item.date > f.end.date) warnings.push(`That date is outside this forecast (${fmtDate(f.start.date, { short: true })} – ${end}).`)
  } else {
    const v = item.value
    const when = capital(describeEvery(item.every, item.start))
    const res = f.results[item.id]
    if (v.mode === 'fixed') {
      sentence = `${when}, add ${fmtMoney(v.amount, { sign: true })} ${to}.`
    } else {
      const src = describeSource(v.source, p.start)
      if (!res || res.value == null) {
        sentence = `${when}, add ${possessive(src)} ${v.mode === 'rate' ? 'rate of change' : 'average'} ${to}.`
        warnings.push(res?.reason ?? 'Not enough records.')
        tone = 'warn'
      } else if (v.mode === 'average') {
        sentence = `${when}, add ${possessive(src)} average of ${fmtMoney(res.value, { sign: true })} ${to}.`
      } else {
        const each = periodDays(item.every) === 1 ? '' : `, ${fmtMoney(res.value, { sign: true })} each time,`
        sentence = `${when}, add ${possessive(src)} change of ${fmtMoney(res.perDay ?? 0, { sign: true })} a day${each} ${to}.`
      }
      if (res) basis = `Worked out from ${res.count} record${res.count === 1 ? '' : 's'}${res.days ? ` over ${res.days} days` : ''}, ${describeWindow(v.window)}.`
      if (v.mode === 'average' && periodDays(item.every) < MIN_RATE_DAYS) {
        warnings.push('An average is a typical amount, added once per repeat. Repeating more often than monthly adds it again each time.')
      }
      if (v.source !== LEFT_SOURCE && !same(v.source, target)) {
        warnings.push(`Measured on ${v.source} but changes ${target || 'net equity only'}.`)
      }
      if (isCombinedDrift(item, p)) {
        warnings.push('Nothing in this forecast is listed as income, so this is income and spending combined. Add your pay as an Amount to see spending alone.')
      }
    }
  }

  const totalText =
    times === 0
      ? `Nothing happens by ${end}.`
      : times === 1
        ? `${fmtMoney(total, { sign: true })} by ${end}.`
        : `It keeps adding: ${fmtMoney(total, { sign: true })} over ${times} times by ${end}.`

  let line = 'Moves the total only, not any particular line.'
  if (target) {
    const l = f.lines.find((x) => same(x.name, target))
    if (l) line = `${l.name}: ${fmtMoney(l.start)} → ${fmtMoney(l.values[l.values.length - 1] ?? l.start)} by ${end}, with everything in this forecast.`
  }
  return { sentence, total: totalText, line, basis, warnings, tone: warnings.length ? 'warn' : tone }
}

/** One-line summary for the list: amount per occurrence, then how and when. */
export function summarize(item: ProjectionItem, res: ItemResult | undefined, p: ProjectionFile): { amount: string; detail: string; tone: ResultText['tone'] } {
  const s = summarizeValue(item, res, p)
  const t = targetOf(item)
  const combined = isCombinedDrift(item, p) ? ' · income and spending combined' : ''
  return { ...s, detail: `${s.detail}${combined}${t ? ` · → ${t}` : ''}` }
}

function summarizeValue(item: ProjectionItem, res: ItemResult | undefined, p: ProjectionFile): { amount: string; detail: string; tone: ResultText['tone'] } {
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
