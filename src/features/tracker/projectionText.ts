// Plain-language text for projections (the items of a forecast): their four
// types as the editor shows them, one-line summaries for the list, the live
// preview, and a colour per projection for the chart.
import {
  type ItemKind,
  type ItemResult,
  type ProjectionFile,
  type ProjectionItem,
  type RecordRange,
  describeSource,
} from '../../lib/finance'
import { fmtDate, fmtMoney } from '../../lib/money'

export const KIND_ORDER: ItemKind[] = ['recurring', 'oneTime', 'averaged', 'extrapolate']

/**
 * The four types the editor offers. They map onto the stored kinds:
 *   recurring  = 'recurring' (fixed amount) or 'averaged' with mode 'amount' (a line's average)
 *   oneTime    = 'oneTime'
 *   cyclical   = 'extrapolate' (builds up through the month, then the month starts over)
 *   cumulative = 'averaged' with mode 'rate' (a trend that keeps adding up, e.g. everyday spending)
 */
export type UiType = 'recurring' | 'oneTime' | 'cyclical' | 'cumulative'
export const UI_TYPES: UiType[] = ['recurring', 'oneTime', 'cyclical', 'cumulative']
export const UI_INFO: Record<UiType, { label: string; help: string }> = {
  recurring: { label: 'Recurring', help: 'Every month on the same day: a fixed amount, or a line’s average from your records.' },
  oneTime: { label: 'One-time', help: 'A single amount on one date.' },
  cyclical: {
    label: 'Cyclical',
    help: 'Builds up through the month and starts over: carries a value from your latest record to month end at the same pace.',
  },
  cumulative: {
    label: 'Cumulative',
    help: 'A trend that keeps adding up: how fast something has been changing in your records, continued day by day.',
  },
}

export function uiTypeOf(item: ProjectionItem): UiType {
  if (item.kind === 'oneTime') return 'oneTime'
  if (item.kind === 'extrapolate') return 'cyclical'
  if (item.kind === 'averaged') return item.mode === 'rate' ? 'cumulative' : 'recurring'
  return 'recurring'
}

/** Chart colours for projections, from the look's palette (cycled). */
const PALETTE = ['var(--alert-note)', 'var(--alert-warning)', 'var(--alert-important)', 'var(--alert-tip)', 'var(--alert-caution)', 'var(--accent)']
export const colorFor = (index: number) => PALETTE[index % PALETTE.length]
export const START_COLOR = 'color-mix(in srgb, var(--mute) 45%, transparent)'

export const KIND_INFO: Record<ItemKind, { label: string; help: string; placeholder: string }> = {
  recurring: {
    label: 'Every month',
    help: 'The same amount on the same day each month: a paycheck, rent, a subscription.',
    placeholder: 'e.g. Paycheck',
  },
  oneTime: {
    label: 'One time',
    help: 'A single amount on one date: a tax refund, a trip, a big purchase.',
    placeholder: 'e.g. Tax refund',
  },
  averaged: {
    label: 'Average from records',
    help: 'Worked out from your past records: how fast something has been changing, or its typical value.',
    placeholder: 'e.g. Everyday spending',
  },
  extrapolate: {
    label: 'Extrapolate to month end',
    help: 'Takes a value from your latest record and carries it to the end of that month at the same pace.',
    placeholder: 'e.g. Amex to month end',
  },
}

export function describeRange(r: RecordRange): string {
  if (r.mode === 'all') return 'all records'
  if (r.mode === 'last') return `past ${r.days} days`
  if (r.from && r.to) return `${fmtDate(r.from, { short: true })} – ${fmtDate(r.to, { short: true })}`
  if (r.from) return `from ${fmtDate(r.from, { short: true })}`
  if (r.to) return `to ${fmtDate(r.to, { short: true })}`
  return 'all records'
}

export interface ResultText {
  text: string
  tone: 'pos' | 'neg' | 'warn' | ''
  tag?: string
}

const toneOf = (v: number): ResultText['tone'] => (v > 0 ? 'pos' : v < 0 ? 'neg' : '')

/** What a computed item works out to, in a sentence. */
export function describeResult(item: ProjectionItem, res: ItemResult, p: ProjectionFile): ResultText {
  if (item.kind === 'extrapolate') {
    if (res.outdated) return { text: 'Your latest record is from an earlier month, so its value is used as is.', tone: 'warn', tag: 'Outdated' }
    if (res.value == null) return { text: res.reason ?? '', tone: 'warn' }
    return {
      text: `${fmtMoney(res.value, { sign: true })} more by month end, at the pace of ${describeSource(item.source, p.start)} so far this month.`,
      tone: toneOf(res.value),
    }
  }
  if (item.kind === 'averaged') {
    if (res.value == null) return { text: res.reason ?? '', tone: 'warn' }
    const span = `from ${res.count} record${res.count === 1 ? '' : 's'}${res.days ? ` over ${res.days} days` : ''}`
    return item.mode === 'rate'
      ? { text: `${fmtMoney(res.value, { sign: true })} a month, spread daily (${span}).`, tone: toneOf(res.value) }
      : { text: `${fmtMoney(res.value, { sign: true })} on day ${item.day} of each month (${span}).`, tone: toneOf(res.value) }
  }
  return { text: '', tone: '' }
}

/** One-line summary for the item list: amount first, then when / how. */
export function summarize(
  item: ProjectionItem,
  res: ItemResult | undefined,
  p: ProjectionFile,
): { amount: string; detail: string; tone: ResultText['tone']; tag?: string } {
  switch (item.kind) {
    case 'recurring':
      return {
        amount: fmtMoney(item.amount, { sign: true }),
        detail: `every month on day ${item.day}${item.inRecord ? ' · in records until paid' : ''}`,
        tone: toneOf(item.amount),
      }
    case 'oneTime':
      return { amount: fmtMoney(item.amount, { sign: true }), detail: `on ${fmtDate(item.date)}`, tone: toneOf(item.amount) }
    case 'averaged': {
      const src = describeSource(item.source, p.start)
      const how = item.mode === 'rate' ? `trend of ${src}` : `average of ${src}, every month on day ${item.day}`
      if (!res || res.value == null) return { amount: '—', detail: `${how} · ${describeRange(item.range)} · needs more records`, tone: 'warn' }
      return {
        amount: `${fmtMoney(res.value, { sign: true })}${item.mode === 'rate' ? '/mo' : ''}`,
        detail: `${how} · ${describeRange(item.range)}`,
        tone: toneOf(res.value),
      }
    }
    case 'extrapolate': {
      const src = describeSource(item.source, p.start)
      if (res?.outdated) return { amount: '$0', detail: `${src} to month end`, tone: 'warn', tag: 'Outdated' }
      if (!res || res.value == null) return { amount: '—', detail: `${src} to month end · ${res?.reason ?? ''}`, tone: 'warn' }
      return { amount: fmtMoney(res.value, { sign: true }), detail: `${src} to month end, at this month's pace`, tone: toneOf(res.value) }
    }
  }
}
