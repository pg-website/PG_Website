import { NO_VALUE } from '@/lib/format/placeholder'

const RUPEE = '₹'
const MINUS = '−'
const FREE = 'Free'
const INDIAN_GROUPS = /\B(?=(\d{2})+$)/g
const RUPEES = /^(\d{1,7})(?:\.(\d{1,2}))?$/

export interface InrOptions {
  /** `free` shows "Free" for 0 (default, FEAT-001 AC-115). `amount` shows "₹0", for totals on a free registration. */
  zero?: 'free' | 'amount'
}

// Indian digit grouping: the last three digits, then pairs (1,20,000 and 12,34,56,789).
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits
  return `${digits.slice(0, -3).replace(INDIAN_GROUPS, ',')},${digits.slice(-3)}`
}

/**
 * Formats integer paise as rupees (FEAT-001 AC-115, A-07). Pure digit manipulation, no `Intl`, so the text is the same
 * on the server and in every browser.
 *
 * 0 gives "Free"; whole rupees have no decimals ("₹500"); otherwise exactly two ("₹1,500.50"; 1 paise is "₹0.01");
 * Indian grouping ("₹1,20,000"). Money is exact: there is no rounding, so a non-integer or unsafe-integer input
 * (a bug upstream) gives "—" rather than a wrong amount. Negative amounts (refunds) use U+2212: "−₹500".
 */
export function formatInr(paise: number, options: InrOptions = {}): string {
  if (typeof paise !== 'number' || !Number.isSafeInteger(paise)) return NO_VALUE
  if (paise === 0) return options.zero === 'amount' ? `${RUPEE}0` : FREE
  const absolute = Math.abs(paise)
  const rupees = Math.floor(absolute / 100)
  const remainder = absolute % 100
  const fraction = remainder === 0 ? '' : `.${String(remainder).padStart(2, '0')}`
  return `${paise < 0 ? MINUS : ''}${RUPEE}${groupIndian(String(rupees))}${fraction}`
}

/** Exact rupees text to integer paise ("250", "250.5"). Returns null for anything else; never rounds. */
export function rupeesToPaise(text: string): number | null {
  const match = RUPEES.exec(text.trim())
  if (match === null) return null
  const fraction = (match[2] ?? '').padEnd(2, '0')
  return Number(match[1]) * 100 + Number(fraction)
}
