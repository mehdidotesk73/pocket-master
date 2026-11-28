// Plain-language text for projections (the amounts in a forecast): type labels,
// one-line summaries for the list, the editor's readback, and a colour per
// projection for the chart.
import { type Every, LEFT_SOURCE, type PastLink, type Projection, type ProjectionItem, type RecordWindow, periodDays } from '../../lib/finance'
import type { PastMeasure } from '../../lib/analysis'
import { fmtDate, fmtMoney, parseDate } from '../../lib/money'

export type UiType = 'recurring' | 'oneTime'
export const UI_TYPES: UiType[] = ['recurring', 'oneTime']
export const UI_INFO: Record<UiType, { label: string; help: string }> = {
  recurring: { label: 'Recurring', help: 'An amount that repeats every so many days, weeks, months or years.' },
  oneTime: { label: 'One-time', help: 'An amount on one date.' },
}
export const uiTypeOf = (item: ProjectionItem): UiType => item.kind

/** Chart colours for projections, from the look's palette (cycled). */
const PALETTE = ['var(--alert-note)', 'var(--alert-warning)', 'var(--alert-important)', 'var(--alert-tip)', 'var(--alert-caution)', 'var(--accent)']
export const colorFor = (index: number) => PALETTE[index % PALETTE.length]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "every day from Dec 4", "every 2 weeks from Dec 4", "every month on the 15th", "every year on Apr 15". */
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

/** "the past 90 days", "the last 6 records", "all records", "Oct 1 – Nov 30". */
export function describeWindow(w: RecordWindow): string {
  switch (w.mode) {
    case 'all':
      return 'all records'
    case 'last':
      return `the past ${w.days} day${w.days === 1 ? '' : 's'}`
    case 'lastRecords':
      return `the last ${w.count} record${w.count === 1 ? '' : 's'}`
    case 'between':
      if (w.from && w.to) return `${fmtDate(w.from, { short: true })} – ${fmtDate(w.to, { short: true })}`
      if (w.from) return `records from ${fmtDate(w.from, { short: true })}`
      if (w.to) return `records until ${fmtDate(w.to, { short: true })}`
      return 'all records'
  }
}

export const lineLabel = (line: string) => (line === LEFT_SOURCE ? 'Net equity' : line)

/** "Amex", "Amex + Discover + Capital One", "Amex, Discover and 3 more lines". */
export function linesLabel(lines: string[]): string {
  const names = lines.map(lineLabel)
  if (names.length <= 3) return names.join(' + ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more lines`
}

/** "Amex's average daily change, falling days only, over the past 90 days". */
export function describeLink(l: PastLink): string {
  const what =
    l.measure === 'average'
      ? 'average'
      : `average daily change${l.direction === 'falling' ? ', falling days only,' : l.direction === 'rising' ? ', rising days only,' : ''}`
  const who = linesLabel(l.lines)
  return `${who}${who.endsWith('lines') ? '’' : '’s'} ${what} over ${describeWindow(l.window)}`
}

/** How a linked amount was worked out: "From 12 records, Sep 1 – Nov 28: −$1.07 a day × 30.44 days." */
export function describeMeasure(l: PastLink, m: PastMeasure, every: Every): string {
  if (!m.count) return 'No records in that window yet, so it’s $0 for now.'
  const span = m.from === m.to ? fmtDate(m.from!, { short: true }) : `${fmtDate(m.from!, { short: true })} – ${fmtDate(m.to!, { short: true })}`
  const from = `From ${m.count} record${m.count === 1 ? '' : 's'}, ${span}`
  if (l.measure === 'average') return `${from}: an average of ${fmtMoney(m.value)}.`
  if (!m.days) return `${from}: a rate needs records on at least two dates, so it’s $0 for now.`
  const days = periodDays(every)
  return `${from}: ${fmtMoney(m.value, { sign: true })} a day${days === 1 ? '' : ` × ${days} days`}.`
}

export type Tone = 'pos' | 'neg' | 'warn' | ''
const toneOf = (v: number): Tone => (v > 0 ? 'pos' : v < 0 ? 'neg' : '')

export interface ReadBack {
  /** The projection as one sentence. */
  sentence: string
  /** What it adds up to by the end of the forecast. */
  total: string
  warnings: string[]
  tone: Tone
}

/** The editor's readback: the projection as a sentence, and what it adds up to in this forecast. */
export function readBack(item: ProjectionItem, f: Projection): ReadBack {
  const run = f.contributions[item.id] ?? []
  const total = run.length ? run[run.length - 1] : 0
  const times = run.filter((v, i) => Math.abs(v - (i ? run[i - 1] : 0)) >= 0.005).length
  const end = fmtDate(f.end.date)
  const amount = fmtMoney(item.amount, { sign: true })
  const warnings: string[] = []
  let sentence: string
  if (item.kind === 'oneTime') {
    sentence = `${amount} on ${fmtDate(item.date)}.`
    if (item.date <= f.start.date || item.date > f.end.date) warnings.push(`That date is outside this forecast (${fmtDate(f.start.date, { short: true })} – ${end}).`)
  } else if (item.link) {
    sentence = `${capital(describeEvery(item.every, item.start))}: ${describeLink(item.link)}, now ${amount}.`
  } else {
    sentence = `${capital(describeEvery(item.every, item.start))}: ${amount}.`
  }
  const totalText =
    times === 0 ? `Nothing by ${end}.` : times === 1 ? `${fmtMoney(total, { sign: true })} by ${end}.` : `${times} times, ${fmtMoney(total, { sign: true })} in all by ${end}.`
  return { sentence, total: totalText, warnings, tone: warnings.length ? 'warn' : toneOf(item.amount) }
}

/** One-line summary for the list: the amount, then when (and, for a linked one, what it's measured from). */
export function summarize(item: ProjectionItem): { amount: string; detail: string; linked: string; tone: Tone } {
  return {
    amount: fmtMoney(item.amount, { sign: true }),
    detail: item.kind === 'oneTime' ? `on ${fmtDate(item.date)}` : describeEvery(item.every, item.start),
    linked: item.kind === 'recurring' && item.link ? describeLink(item.link) : '',
    tone: toneOf(item.amount),
  }
}
