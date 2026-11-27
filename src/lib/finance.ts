// Budget calculations. Pure functions over the stored data:
//   records/<date>.json        → BalanceRecord
//   projections/<id>.json      → ProjectionFile (one per projection the user builds)
//   template.json              → TemplateFile (rows new records start with)
// Everything else (totals, averages, the projection) is computed from those.
// No Vue, no storage: unit-tested in finance.test.ts.
//
// All arithmetic is in integer cents. Amounts are signed everywhere:
// positive = money you have / money coming in, negative = owed / going out.

import {
  type ISODate,
  type LocalDateTime,
  addDays,
  clampedDate,
  dayNum,
  daysInMonth,
  fromCents,
  isISODate,
  monthIndex,
  parseDate,
  toCents,
  ymd,
} from './money'

// ---------------------------------------------------------------- types

/** One line of a record. Positive = asset, negative = liability. */
export interface RecordLine {
  id: string
  name: string
  amount: number
}

export interface BalanceRecord {
  schema: 3
  /** When the balance sheet was taken (local). Records are identified and ordered by this. */
  at: LocalDateTime
  /** The date part of `at`; every day-based calculation uses it. */
  date: ISODate
  savedAt: string
  lines: RecordLine[]
  /** Σ positive lines */
  assets: number
  /** Σ |negative lines| (stored as a positive number) */
  liabilities: number
  left: number
}

/** A row of the record template: what every new record starts with. */
export interface TemplateLine {
  id: string
  name: string
  /** Optional starting amount (signed). Prefill from the latest record wins over this. */
  amount?: number
  /** Sign to use while the amount is empty. */
  negative: boolean
}

export interface TemplateFile {
  schema: 1
  rows: TemplateLine[]
}

/** A change that repeats every month on `day` (1–31, clamped to the month's last day). */
export interface Recurring {
  kind: 'recurring'
  id: string
  name: string
  /** signed: + coming in, − going out */
  amount: number
  day: number
  /**
   * This month's amount already shows up as a line in the records (e.g. rent
   * listed until paid). Skipped in the latest record's month; counted at the
   * start of later months when working out averages.
   */
  inRecord: boolean
}

/** A single change on a date. */
export interface OneTime {
  kind: 'oneTime'
  id: string
  name: string
  /** signed */
  amount: number
  date: ISODate
}

/** `source` value meaning "the projection's starting total" rather than one named line. */
export const LEFT_SOURCE = ''

/** Which records an average looks at. 'last' counts back from the latest record. */
export type RecordRange =
  | { mode: 'all' }
  | { mode: 'last'; days: number }
  | { mode: 'between'; from?: ISODate; to?: ISODate }

/**
 * A change worked out from past records.
 * - 'rate': the source's average change per month across the range becomes a
 *   steady daily drift. For the starting total, this projection's scheduled
 *   items in the range are removed first (they're projected separately).
 * - 'amount': the source line's average value across the range, applied once a
 *   month on `day`.
 */
export interface Averaged {
  kind: 'averaged'
  id: string
  name: string
  /** LEFT_SOURCE for the starting total, else a record line name (matched case-insensitively). */
  source: string
  mode: 'rate' | 'amount'
  range: RecordRange
  /** 'amount' mode: day of month to apply it. */
  day: number
}

/**
 * Carries a value from the latest record on to the end of that month at the
 * same pace: a value V on day k of an n-day month becomes V × n / k, the
 * difference spread over the rest of the month. Only while that month is the
 * current one; a record from an earlier month is used as is and marked outdated.
 */
export interface Extrapolate {
  kind: 'extrapolate'
  id: string
  name: string
  /** LEFT_SOURCE for the starting total, else a record line name. */
  source: string
}

export type ProjectionItem = Recurring | OneTime | Averaged | Extrapolate
export type ItemKind = ProjectionItem['kind']

/** Which lines of the latest record a projection starts from. */
export type StartLines = { mode: 'all' } | { mode: 'lines'; names: string[] }

export interface ProjectionFile {
  schema: 2
  id: string
  name: string
  start: StartLines
  /** How many days ahead to project. */
  horizonDays: number
  items: ProjectionItem[]
}

export const HORIZON_PRESETS = [30, 90, 180, 365]
export const MAX_HORIZON_DAYS = 1830

/** Average days per month, used to turn monthly ↔ daily rates. */
export const DAYS_PER_MONTH = 30.44
/** A rate needs records spanning at least this many days. */
export const MIN_RATE_DAYS = 28

// ---------------------------------------------------------------- records

export interface Sheet {
  assets: number
  liabilities: number
  left: number
}

/** Positive lines are assets, negative lines are liabilities; left = assets − liabilities. */
export function sheet(lines: Pick<RecordLine, 'amount'>[]): Sheet {
  let a = 0
  let l = 0
  for (const line of lines) {
    const v = toCents(line.amount)
    if (v > 0) a += v
    else l -= v
  }
  return { assets: fromCents(a), liabilities: fromCents(l), left: fromCents(a - l) }
}

/** Oldest first, by date and time. */
export const byAt = (a: Pick<BalanceRecord, 'at'>, b: Pick<BalanceRecord, 'at'>) => a.at.localeCompare(b.at)

/**
 * Build a complete record (with stored totals) from its lines. `at` is a local
 * date-time; a bare date is taken as noon that day.
 */
export function makeRecord(at: LocalDateTime | ISODate, lines: RecordLine[], savedAt = new Date().toISOString()): BalanceRecord {
  const when = isISODate(at) ? `${at}T12:00:00` : at
  return { schema: 3, at: when, date: when.slice(0, 10), savedAt, lines, ...sheet(lines) }
}

/** Insert, or replace the record with the same `at`; result oldest first. Same-day records coexist. */
export function upsertRecord(records: BalanceRecord[], rec: BalanceRecord): BalanceRecord[] {
  return [...records.filter((r) => r.at !== rec.at), rec].sort(byAt)
}

/** Every line name that appears in any record, in first-seen order (newest records first). */
export function lineNames(records: BalanceRecord[]): string[] {
  const seen = new Map<string, string>()
  for (const r of [...records].reverse()) {
    for (const l of r.lines) {
      const k = norm(l.name)
      if (k && !seen.has(k)) seen.set(k, l.name.trim())
    }
  }
  return [...seen.values()]
}

const norm = (s: string) => s.trim().toLowerCase()

// ---------------------------------------------------------------- scheduled flows

/**
 * Net scheduled flow (cents) in the window (s0, s1].
 * `inRecord` recurring items count once at the start of each month after s0's
 * month, because the next record will list them as due.
 */
export function scheduledCents(s0: ISODate, s1: ISODate, recurring: Recurring[], oneTime: OneTime[]): number {
  const d0 = dayNum(s0)
  const d1 = dayNum(s1)
  if (d1 <= d0) return 0
  const m0 = monthIndex(s0)
  const m1 = monthIndex(s1)
  let total = 0
  for (let M = m0; M <= m1; M++) {
    for (const r of recurring) {
      if (r.inRecord) {
        if (M > m0) total += toCents(r.amount)
      } else {
        const occ = dayNum(clampedDate(M, r.day))
        if (occ > d0 && occ <= d1) total += toCents(r.amount)
      }
    }
  }
  for (const o of oneTime) {
    const od = dayNum(o.date)
    if (od > d0 && od <= d1) total += toCents(o.amount)
  }
  return total
}

export function scheduled(s0: ISODate, s1: ISODate, recurring: Recurring[], oneTime: OneTime[]): number {
  return fromCents(scheduledCents(s0, s1, recurring, oneTime))
}

// ---------------------------------------------------------------- start lines

const inStart = (start: StartLines) => {
  if (start.mode === 'all') return () => true
  const keys = new Set(start.names.map(norm))
  return (name: string) => keys.has(norm(name))
}

/** The projection's starting total in a record: the sum of its selected lines (all = left so far). */
export function startValueCents(r: BalanceRecord, start: StartLines): number {
  if (start.mode === 'all') return toCents(r.left)
  const has = inStart(start)
  return r.lines.filter((l) => has(l.name)).reduce((s, l) => s + toCents(l.amount), 0)
}

/** The source's signed value in a record (cents), or null when the record doesn't have that line. */
function sourceValue(r: BalanceRecord, source: string, start: StartLines): number | null {
  if (source === LEFT_SOURCE) return startValueCents(r, start)
  const k = norm(source)
  const hits = r.lines.filter((l) => norm(l.name) === k)
  return hits.length ? hits.reduce((s, l) => s + toCents(l.amount), 0) : null
}

export function describeSource(source: string, start: StartLines): string {
  if (source !== LEFT_SOURCE) return source
  return start.mode === 'all' ? 'left so far' : 'the starting total'
}

// ---------------------------------------------------------------- averaged items

export interface ItemResult {
  /** Signed dollars per month (rate / amount), or the extra to month end (extrapolate); null if not computable. */
  value: number | null
  /** What the projection uses: value, or 0 when null. */
  used: number
  /** Records used and the days they span (averaged). */
  count: number
  days: number
  /** Extrapolate: the latest record is from an earlier month than today. */
  outdated?: boolean
  /** Why `value` is null, in plain words. */
  reason?: string
}

export function recordsInRange(records: BalanceRecord[], range: RecordRange): BalanceRecord[] {
  const sorted = [...records].sort(byAt)
  if (range.mode === 'all' || !sorted.length) return sorted
  if (range.mode === 'last') {
    const cut = dayNum(sorted[sorted.length - 1].date) - Math.max(0, Math.round(range.days))
    return sorted.filter((r) => dayNum(r.date) >= cut)
  }
  return sorted.filter((r) => (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to))
}

export function evaluateAveraged(
  item: Averaged,
  records: BalanceRecord[],
  proj: Pick<ProjectionFile, 'items' | 'start'>,
): ItemResult {
  const points = recordsInRange(records, item.range)
    .map((r) => ({ date: r.date, v: sourceValue(r, item.source, proj.start) }))
    .filter((p): p is { date: ISODate; v: number } => p.v != null)
  const days = points.length ? dayNum(points[points.length - 1].date) - dayNum(points[0].date) : 0
  const finish = (value: number | null, reason?: string): ItemResult => ({ value, used: value ?? 0, count: points.length, days, reason })

  if (!points.length) {
    return finish(null, item.source === LEFT_SOURCE ? 'No records in this range.' : `No records in this range have a line called “${item.source}”.`)
  }
  if (item.mode === 'amount') return finish(fromCents(points.reduce((s, p) => s + p.v, 0) / points.length))

  if (points.length < 2 || days < MIN_RATE_DAYS) {
    return finish(null, `Needs records spanning ${Math.ceil(MIN_RATE_DAYS / 7)}+ weeks (this range has ${days} day${days === 1 ? '' : 's'}).`)
  }
  const { recurring, oneTime } = split(proj.items)
  let change = 0
  for (let i = 1; i < points.length; i++) {
    change += points[i].v - points[i - 1].v
    if (item.source === LEFT_SOURCE) change -= scheduledCents(points[i - 1].date, points[i].date, recurring, oneTime)
  }
  return finish(fromCents((change / days) * DAYS_PER_MONTH))
}

// ---------------------------------------------------------------- extrapolate

export function evaluateExtrapolate(
  item: Extrapolate,
  latest: BalanceRecord | null,
  start: StartLines,
  today: ISODate,
): ItemResult {
  const base = { count: latest ? 1 : 0, days: 0 }
  if (!latest) return { ...base, value: null, used: 0, reason: 'No records yet.' }
  const v = sourceValue(latest, item.source, start)
  if (v == null) return { ...base, value: null, used: 0, reason: `The latest record has no line called “${item.source}”.` }
  if (monthIndex(latest.date) !== monthIndex(today)) {
    return { ...base, value: 0, used: 0, outdated: true, reason: 'The latest record is from an earlier month, so its value is used as is.' }
  }
  const { y, m, day } = parseDate(latest.date)
  const n = daysInMonth(y, m)
  const extra = (v * n) / day - v
  return { ...base, value: fromCents(extra), used: fromCents(extra) }
}

// ---------------------------------------------------------------- projection

export interface Point {
  date: ISODate
  value: number
}

export interface Projection {
  start: Point
  series: Point[]
  end: Point
  min: Point
  /** Per item id, for averaged and extrapolate items. */
  results: Record<string, ItemResult>
  /** Per item id: its cumulative change by each day of `series` (dollars, same length). */
  contributions: Record<string, number[]>
  /** Net daily drift from rate items (dollars/day). */
  dailyDrift: number
}

function split(items: ProjectionItem[]) {
  return {
    recurring: items.filter((i): i is Recurring => i.kind === 'recurring'),
    oneTime: items.filter((i): i is OneTime => i.kind === 'oneTime'),
    averaged: items.filter((i): i is Averaged => i.kind === 'averaged'),
    extrapolate: items.filter((i): i is Extrapolate => i.kind === 'extrapolate'),
  }
}

/** Results for the computed items (shown in the editor even before a projection exists). */
export function itemResults(proj: ProjectionFile, records: BalanceRecord[], today: ISODate): Record<string, ItemResult> {
  const latest = [...records].sort(byAt).pop() ?? null
  const out: Record<string, ItemResult> = {}
  for (const it of proj.items) {
    if (it.kind === 'averaged') out[it.id] = evaluateAveraged(it, records, proj)
    else if (it.kind === 'extrapolate') out[it.id] = evaluateExtrapolate(it, latest, proj.start, today)
  }
  return out
}

export function project(proj: ProjectionFile, records: BalanceRecord[], today: ISODate): Projection | null {
  const sorted = [...records].sort(byAt)
  const latest = sorted[sorted.length - 1]
  if (!latest) return null
  const horizonDays = Math.min(MAX_HORIZON_DAYS, Math.max(1, Math.round(proj.horizonDays)))
  const latestMonth = monthIndex(latest.date)
  const results = itemResults(proj, sorted, today)
  // Each item's change per day (cents), so the forecast can show what each one contributes.
  const { y, m } = parseDate(latest.date)
  const monthEnd = dayNum(ymd(y, m, daysInMonth(y, m)))
  const restDays = monthEnd - dayNum(latest.date)
  const stepFor = (it: ProjectionItem): ((d: ISODate, mi: number) => number) => {
    switch (it.kind) {
      case 'recurring':
        return (d, mi) => (clampedDate(mi, it.day) === d && !(it.inRecord && mi === latestMonth) ? toCents(it.amount) : 0)
      case 'oneTime':
        return (d) => (d === it.date ? toCents(it.amount) : 0)
      case 'averaged': {
        const used = toCents(results[it.id].used)
        if (it.mode === 'rate') return () => used / DAYS_PER_MONTH
        return (d, mi) => (clampedDate(mi, it.day) === d ? used : 0)
      }
      case 'extrapolate': {
        const perDay = restDays > 0 ? toCents(results[it.id].used) / restDays : 0
        return (d) => (dayNum(d) <= monthEnd ? perDay : 0)
      }
    }
  }
  const steps = proj.items.map((it) => ({ id: it.id, step: stepFor(it) }))
  const running = new Map<string, number>(proj.items.map((it) => [it.id, 0]))
  const contributions: Record<string, number[]> = Object.fromEntries(proj.items.map((it) => [it.id, [] as number[]]))

  const startCents = startValueCents(latest, proj.start)
  let value = startCents
  const series: Point[] = []
  for (let i = 1; i <= horizonDays; i++) {
    const d = addDays(latest.date, i)
    const mi = monthIndex(d)
    for (const { id, step } of steps) {
      const c = step(d, mi)
      value += c
      running.set(id, running.get(id)! + c)
      contributions[id].push(fromCents(running.get(id)!))
    }
    series.push({ date: d, value: fromCents(value) })
  }
  const start = { date: latest.date, value: fromCents(startCents) }
  const end = series[series.length - 1] ?? start
  let min = series[0] ?? start
  for (const p of series) if (p.value < min.value) min = p
  const driftCents = proj.items.reduce(
    (s2, it) => s2 + (it.kind === 'averaged' && it.mode === 'rate' ? toCents(results[it.id].used) / DAYS_PER_MONTH : 0),
    0,
  )
  return { start, series, end, min, results, contributions, dailyDrift: fromCents(driftCents) }
}

// ---------------------------------------------------------------- defaults & ids

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

export function everydayItem(): Averaged {
  return { kind: 'averaged', id: 'everyday', name: 'Everyday spending', source: LEFT_SOURCE, mode: 'rate', range: { mode: 'all' }, day: 1 }
}

export function defaultProjection(id = 'everything'): ProjectionFile {
  return { schema: 2, id, name: 'Everything', start: { mode: 'all' }, horizonDays: 90, items: [everydayItem()] }
}

/** The default rows before v0.6.2, so a never-customised template can be updated to the new default. */
export const PREVIOUS_DEFAULT_TEMPLATE_IDS = ['checking', 'rent', 'phone-ins', 'discover', 'capone', 'amex', 'macys', 'paying', 'receiving']

/** First-run template: rows only, no amounts. */
export function defaultTemplate(): TemplateFile {
  const row = (id: string, name: string, negative: boolean): TemplateLine => ({ id, name, negative })
  return {
    schema: 1,
    rows: [
      row('checking', 'Checking', false),
      row('discover', 'Discover', true),
      row('capone', 'Capital One', true),
      row('amex', 'Amex', true),
      row('macys', 'Macy’s', true),
      row('saving', 'Saving', false),
    ],
  }
}
