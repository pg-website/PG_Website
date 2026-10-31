'use client'

import Script from 'next/script'
import { notifyRazorpayFailed, notifyRazorpayLoaded } from '@/lib/payments/load-razorpay'

/** Renders Razorpay's checkout.js through next/script (nonce-aware) and reports the outcome to `loadRazorpay()`. */
export function RazorpayScript() {
  return (
    <Script
      src="https://checkout.razorpay.com/v1/checkout.js"
      strategy="afterInteractive"
      onReady={notifyRazorpayLoaded}
      onError={notifyRazorpayFailed}
    />
  )
}
