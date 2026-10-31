'use client'

import type { Route } from 'next'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Banner } from '@/components/ui/feedback/Banner'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { Heading } from '@/components/ui/Heading'
import { InfoRow } from '@/components/ui/InfoRow'
import { InfoStack } from '@/components/ui/InfoStack'
import { ArrowRight } from '@/components/ui/icons/ArrowRight'
import { Surface } from '@/components/ui/Surface'
import { Text } from '@/components/ui/Text'
import { TextLink } from '@/components/ui/TextLink'
import { Button } from '@/components/ui/Button'
import { describePaidFailure, createOrderInput } from '@/features/registration/paid-registration'
import { useServerCountdown } from '@/features/registration/useServerCountdown'
import { countdownLabel, formatCountdown } from '@/features/registration/waitlist'
import { useApi } from '@/lib/api/adapters/useApi.browser'
import type { EventDetailDto } from '@/lib/api/types/event'
import type { PaymentOrderDto } from '@/lib/api/types/payment'
import type { RegistrationDto } from '@/lib/api/types/registration'
import { qk, type AppQueryKey } from '@/lib/query/keys'
import { useApiMutation } from '@/lib/query/mutation'
import { envPublic } from '@/lib/env/env.public'
import { loadRazorpay } from '@/lib/payments/load-razorpay'
import { RazorpayScript } from '@/lib/payments/RazorpayScript'

// Screen 18 (hold_active state). EV-04 / FE-08.
// The registration hold exists. A countdown shows time remaining from the server clock. "Pay now" calls R04 to get
// the Razorpay order, then opens the checkout modal. The Razorpay SDK is loaded on demand by
// loadRazorpay() (warmed on mount, awaited on click) only when RAZORPAY_ENABLED=true, so it never reaches the main bundle.
//
// In fake mode (RAZORPAY_ENABLED=false), a simulated-payment form is shown instead. The developer runs
// `python manage.py razorpay_fake_pay <orderId>` and pastes the output to call R05.
//
// Checkout dismissal (without paying) returns the component to the idle view; the hold countdown continues.

const MY_REGISTRATIONS_PREFIX: AppQueryKey = ['me', 'registrations']

declare global {
  interface Window {
    // Declared to satisfy TypeScript; the Razorpay SDK is loaded at runtime, not imported.
    Razorpay: new (opts: Record<string, unknown>) => { open: () => void }
  }
}

/** In-component sub-state for the checkout step. */
type CheckoutPhase =
  | { phase: 'idle'; error: string | null }
  | { phase: 'ordering' }
  | { phase: 'checkout'; order: PaymentOrderDto }
  | { phase: 'fake_form'; order: PaymentOrderDto; paymentId: string; signature: string; formError: string | null }
  | { phase: 'verifying'; order: PaymentOrderDto }

interface HoldActivePanelProps {
  event: EventDetailDto
  registration: Extract<RegistrationDto, { status: 'pending' }>
}

export function HoldActivePanel({ event, registration }: HoldActivePanelProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const slug = event.slug

  const [checkout, setCheckout] = useState<CheckoutPhase>({ phase: 'idle', error: null })


  // Countdown from server's clock. When it reaches 0, re-read R01 (the server decides what expired means).
  const leftMs = useServerCountdown(registration.holdExpiresAt, registration.serverNow, () => {
    void queryClient.invalidateQueries({ queryKey: qk.registration(slug) })
  })

  const expired = leftMs <= 0

  // R04: create or return the payment order for this registration (idempotent).
  const orderMutation = useApiMutation({
    mutationFn: (_vars: void, { idempotencyKey }) => {
      if (idempotencyKey === null) throw new Error('missing idempotency key')
      return api.player.registration.createPaymentOrder(createOrderInput(registration.id), idempotencyKey)
    },
    invalidates: () => [], // R04 is read-only; R01 is invalidated after R05 succeeds
    onError: (error) => {
      const failure = describePaidFailure(error)
      setCheckout({ phase: 'idle', error: `${failure.title} — ${failure.body}` })
      if (failure.kind === 'hold_expired') {
        void queryClient.invalidateQueries({ queryKey: qk.registration(slug) })
      }
    },
  })

  // R05: verify the payment.
  const verifyMutation = useApiMutation({
    mutationFn: (
      vars: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string },
      { idempotencyKey },
    ) => {
      if (idempotencyKey === null) throw new Error('missing idempotency key')
      return api.player.registration.verifyPayment(vars, idempotencyKey)
    },
    invalidates: () => [qk.registration(slug), qk.registrationAvailability(slug), MY_REGISTRATIONS_PREFIX, qk.nextUp()],
    onError: (error) => {
      const failure = describePaidFailure(error)
      setCheckout({ phase: 'idle', error: `${failure.title} — ${failure.body}` })
      if (failure.kind === 'hold_expired') {
        void queryClient.invalidateQueries({ queryKey: qk.registration(slug) })
      }
    },
    onSuccess: () => {
      // R01 was already invalidated by `invalidates`; the resolver flips to `registered` or `payment_confirming`.
      setCheckout({ phase: 'idle', error: null })
    },
  })

  function openRazorpayModal(order: PaymentOrderDto) {
    const rzp = new window.Razorpay({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      order_id: order.orderId,
      name: "Pawn's Gambit",
      description: event.title,
      handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        setCheckout({ phase: 'verifying', order })
        verifyMutation.mutate(response)
      },
      modal: {
        // Dismissed without paying: return to the countdown so the player can retry.
        ondismiss: () => setCheckout({ phase: 'idle', error: null }),
      },
    })
    rzp.open()
  }

  async function startPayment() {
    if (checkout.phase !== 'idle') return
    setCheckout({ phase: 'ordering' })

    let order: PaymentOrderDto
    try {
      order = await orderMutation.mutateAsync()
    } catch {
      // Error is handled by orderMutation.onError above.
      return
    }

    if (!envPublic.RAZORPAY_ENABLED) {
      setCheckout({ phase: 'fake_form', order, paymentId: '', signature: '', formError: null })
      return
    }

    try {
      await loadRazorpay()
    } catch {
      setCheckout({ phase: 'idle', error: 'The payment page could not be loaded. Check your connection and try again.' })
      return
    }

    setCheckout({ phase: 'checkout', order })
    openRazorpayModal(order)
  }

  function submitFakeForm() {
    if (checkout.phase !== 'fake_form') return
    const { order, paymentId, signature } = checkout
    if (!paymentId.trim() || !signature.trim()) {
      setCheckout({ ...checkout, formError: 'Both fields are required.' })
      return
    }
    setCheckout({ phase: 'verifying', order })
    verifyMutation.mutate({
      razorpay_order_id: order.orderId,
      razorpay_payment_id: paymentId.trim(),
      razorpay_signature: signature.trim(),
    })
  }

  // Expired state
  if (expired) {
    return (
      <Surface as="section" padding="lg" aria-labelledby="registration-screen-title" className="flex flex-col gap-4">
        <div data-registration-slot="FE-08" data-registration-screen="hold_expired" className="flex flex-col gap-4">
          <Eyebrow>Hold expired</Eyebrow>
          <Heading level={2} size="panel" id="registration-screen-title">
            Your hold has run out.
          </Heading>
          <Text className="max-w-prose">
            The place was released because payment was not completed in time. Nothing was charged. Start again to
            reserve a new place.
          </Text>
          <Banner tone="warning" live="alert">
            The hold ended. No payment was taken.
          </Banner>
          <Button fullWidth onClick={() => void queryClient.invalidateQueries({ queryKey: qk.registration(slug) })}>
            Start again
          </Button>
          <TextLink href={`/events/${slug}` as Route}>Back to event</TextLink>
        </div>
      </Surface>
    )
  }

  // Fake simulated payment form
  if (checkout.phase === 'fake_form') {
    const { order, paymentId, signature, formError } = checkout
    return (
      <Surface as="section" padding="lg" aria-labelledby="registration-screen-title" className="flex flex-col gap-4">
        <div
          data-registration-slot="FE-08"
          data-registration-screen="simulated_payment"
          className="flex flex-col gap-4"
        >
          <Eyebrow>Simulated payment</Eyebrow>
          <Heading level={2} size="panel" id="registration-screen-title">
            Fake mode — no real charge.
          </Heading>
          <Text className="max-w-prose">
            Razorpay checkout is disabled. Run the management command below to simulate a capture, then paste the output
            here.
          </Text>
          <Surface padding="md" aria-label="Management command to run">
            <code className="font-mono text-sm break-all select-all">
              python manage.py razorpay_fake_pay {order.orderId}
            </code>
          </Surface>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">razorpay_payment_id</span>
              <input
                type="text"
                value={paymentId}
                onChange={(e) => setCheckout({ ...checkout, paymentId: e.target.value, formError: null })}
                className="rounded-md bg-surface border border-line px-3 py-2 font-mono text-sm focus:border-forest focus:outline-none"
                placeholder="pay_Fake…"
                aria-label="Paste razorpay_payment_id from management command output"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">razorpay_signature</span>
              <input
                type="text"
                value={signature}
                onChange={(e) => setCheckout({ ...checkout, signature: e.target.value, formError: null })}
                className="rounded-md bg-surface border border-line px-3 py-2 font-mono text-sm focus:border-forest focus:outline-none"
                placeholder="64-character hex string"
                aria-label="Paste razorpay_signature from management command output"
              />
            </label>
          </div>
          {formError !== null && (
            <Banner tone="danger" live="alert">
              {formError}
            </Banner>
          )}
          <Button
            fullWidth
            loading={verifyMutation.isPending}
            loadingLabel="Verifying payment"
            icon={<ArrowRight />}
            iconPosition="end"
            onClick={submitFakeForm}
          >
            Confirm simulated payment
          </Button>
          <Button variant="secondary" fullWidth onClick={() => setCheckout({ phase: 'idle', error: null })}>
            Cancel
          </Button>
        </div>
      </Surface>
    )
  }

  // Default: idle countdown + pay button; covers 'ordering', 'checkout', 'verifying' as loading states.
  const isBusy = checkout.phase === 'ordering' || checkout.phase === 'checkout' || checkout.phase === 'verifying'
  const busyLabel =
    checkout.phase === 'ordering'
      ? 'Preparing payment'
      : checkout.phase === 'checkout'
        ? 'Checkout open'
        : checkout.phase === 'verifying'
          ? 'Verifying payment'
          : undefined
  return (
    <>
      {/* Starts loading on mount so the SDK is usually ready before the click; startPayment awaits it either way. */}
      {envPublic.RAZORPAY_ENABLED && <RazorpayScript />}
      <Surface as="section" padding="lg" aria-labelledby="registration-screen-title" className="flex flex-col gap-4">
        <div data-registration-slot="FE-08" data-registration-screen="hold_active" className="flex flex-col gap-4">
          <Eyebrow>Your place is held</Eyebrow>
          <Heading level={2} size="panel" id="registration-screen-title">
            One last step.
          </Heading>
          <Text className="max-w-prose">Complete payment before the timer runs out to keep your place.</Text>
          <Surface padding="md" aria-label="Hold status">
            <InfoStack>
              <InfoRow label="Time left">
                <span role="timer" aria-label={countdownLabel(leftMs)}>
                  {formatCountdown(leftMs)}
                </span>
              </InfoRow>
              <InfoRow label="Payment">Not taken yet</InfoRow>
            </InfoStack>
          </Surface>
          {checkout.phase === 'checkout' && (
            <Banner tone="info">The Razorpay payment page is open. Complete payment there, then return here.</Banner>
          )}
          {checkout.phase === 'idle' && checkout.error !== null && (
            <Banner tone="danger" live="alert">
              {checkout.error}
            </Banner>
          )}
          <Button
            fullWidth
            loading={isBusy}
            loadingLabel={busyLabel}
            icon={<ArrowRight />}
            iconPosition="end"
            onClick={() => void startPayment()}
            disabled={isBusy}
          >
            {envPublic.RAZORPAY_ENABLED ? 'Pay now' : 'Simulate payment (fake mode)'}
          </Button>
        </div>
      </Surface>
    </>
  )
}
