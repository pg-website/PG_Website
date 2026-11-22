'use client'

import { useState } from 'react'
import { ConfirmAction } from '@/components/admin/ConfirmAction'
import { Button } from '@/components/ui/Button'
import { Text } from '@/components/ui/Text'
import { Field } from '@/components/ui/form/Field'
import { Input } from '@/components/ui/form/Input'
import { Textarea } from '@/components/ui/form/Textarea'
import { rupeesToPaise } from '@/lib/format/money'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import { withStepUpToken } from '@/lib/api/browser/step-up-prompt'
import { ApiError } from '@/lib/api/errors'
import type { AdminLedgerRowDto } from '@/lib/api/types/admin/payments'
import type { IdempotencyKey } from '@/lib/api/types/primitives'
import { formatInr } from '@/lib/format/money'

/**
 * Refund of one captured payment (G05). Money action: ConfirmAction (Idempotency-Key per intent) plus a fresh step-up
 * token. The browser sends only a reason and an optional partial amount in paise; never a currency or the paid amount.
 * Enabled only from the server's `canRefund` capability; a disabled button shows the server's reason.
 */
export function RefundAction({ row, onDone }: { row: AdminLedgerRowDto; onDone: () => void }) {
  const api = useApi()
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const refundable = row.amountPaise - row.refundedPaise

  const run = async (key: IdempotencyKey): Promise<void> => {
    const trimmed = reason.trim()
    const partial = amount.trim() === '' ? undefined : rupeesToPaise(amount)
    if (trimmed === '' || partial === null || partial === 0 || (partial ?? 0) > refundable) {
      throw new ApiError('VALIDATION_FAILED', { status: 422 })
    }
    await withStepUpToken((token) =>
      api.admin.payments.refund(
        row.id,
        { reason: trimmed, ...(partial === undefined ? {} : { amountPaise: partial }) },
        key,
        { stepUp: token },
      ),
    )
  }

  const capability = row.capabilities.canRefund
  if (!capability.allowed) {
    const reasonId = `refund-blocked-${row.id}`
    return (
      <div>
        <Button variant="secondary" disabled aria-describedby={reasonId}>
          Refund
        </Button>
        <p id={reasonId} className="mt-1 text-sm text-muted">
          {capability.reason}
        </p>
      </div>
    )
  }

  return (
    <ConfirmAction
      renderTrigger={(open) => (
        <Button
          variant="secondary"
          onClick={() => {
            setReason('')
            setAmount('')
            open()
          }}
        >
          Refund
        </Button>
      )}
      title="Refund this payment?"
      consequence={`This asks the payment provider to return money to ${row.playerName} for ${row.eventTitle}. It cannot be undone. The refund stays pending until the provider confirms.`}
      confirmLabel="Refund payment"
      destructive
      actionLabel="refund this payment"
      onConfirm={run}
      onDone={onDone}
    >
      <div className="mt-4 grid gap-4">
        <Text variant="small">
          Paid {formatInr(row.amountPaise, { zero: 'amount' })}, already refunded{' '}
          {formatInr(row.refundedPaise, { zero: 'amount' })}. You will be asked for your password.
        </Text>
        <Field label="Reason" required hint="Up to 500 characters. Kept in the audit log.">
          <Textarea
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value)
            }}
          />
        </Field>
        <Field
          label="Amount in rupees"
          optionalLabel
          hint={`Leave empty for a full refund (${formatInr(refundable, { zero: 'amount' })}).`}
        >
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
            }}
          />
        </Field>
      </div>
    </ConfirmAction>
  )
}
