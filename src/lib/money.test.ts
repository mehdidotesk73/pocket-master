import { describe, expect, it } from 'vitest'
import { fmtMoney, fmtPlain, parseMoney } from './money'

describe('money display', () => {
  it('shows negatives in parentheses', () => {
    expect(fmtMoney(-730.48)).toBe('($730.48)')
    expect(fmtMoney(-1234.5, { sign: true })).toBe('($1,234.50)')
    expect(fmtMoney(1234.5, { sign: true })).toBe('+$1,234.50')
    expect(fmtMoney(-0.001)).toBe('$0.00')
    expect(fmtMoney(-2008.4, { whole: true })).toBe('($2,008)')
    expect(fmtPlain(-730.48)).toBe('(730.48)')
    expect(fmtPlain(7718.6)).toBe('7718.60')
  })

  it('reads the accounting form back as negative', () => {
    expect(parseMoney('(730.48)')).toBe(-730.48)
    expect(parseMoney('($1,234.50)')).toBe(-1234.5)
    expect(parseMoney('-12')).toBe(-12)
    expect(parseMoney('1,234.5')).toBe(1234.5)
    expect(parseMoney('()')).toBeNull()
    expect(parseMoney('')).toBeNull()
  })
})
