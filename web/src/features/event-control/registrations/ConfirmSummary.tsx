import { formatInr, rupeesToPaise } from '@/lib/format/money'

interface ConfirmSummaryProps {
  playerName: string
  eventTitle: string
  eventPricePaise: number | undefined
  amountRupees: string
  free: boolean
}

/** Confirmation view: player, event, published fee and entered amount. */
export function ConfirmSummary({ playerName, eventTitle, eventPricePaise, amountRupees, free }: ConfirmSummaryProps) {
  const enteredPaise = rupeesToPaise(amountRupees)
  const feeMatches = eventPricePaise === undefined || enteredPaise === eventPricePaise
  if (free) {
    return (
      <dl className="grid gap-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="font-semibold text-ink-soft">Player</dt>
          <dd className="text-ink">{playerName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="font-semibold text-ink-soft">Event</dt>
          <dd className="text-ink">{eventTitle}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="font-semibold text-ink-soft">Entry fee</dt>
          <dd className="text-ink">Free</dd>
        </div>
      </dl>
    )
  }
  return (
    <dl className="grid gap-3 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="font-semibold text-ink-soft">Player</dt>
        <dd className="text-ink">{playerName}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="font-semibold text-ink-soft">Event</dt>
        <dd className="text-ink">{eventTitle}</dd>
      </div>
      {eventPricePaise !== undefined ? (
        <div className="flex justify-between gap-4">
          <dt className="font-semibold text-ink-soft">Published fee</dt>
          <dd className="text-ink">{formatInr(eventPricePaise, { zero: 'amount' })}</dd>
        </div>
      ) : null}
      <div className="flex justify-between gap-4">
        <dt className="font-semibold text-ink-soft">Amount collected</dt>
        <dd className={feeMatches ? 'text-ink' : 'font-semibold text-warning-ink'}>
          {enteredPaise !== null ? formatInr(enteredPaise, { zero: 'amount' }) : amountRupees}
        </dd>
      </div>
      {!feeMatches ? (
        <p className="text-xs text-warning-ink">The collected amount differs from the published entry fee.</p>
      ) : null}
    </dl>
  )
}
