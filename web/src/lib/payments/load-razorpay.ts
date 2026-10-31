// Razorpay's checkout.js cannot be bundled or self-hosted. Scripts are injected only through next/script (ARCH-001 17.1),
// so <RazorpayScript> renders it and reports here; `loadRazorpay()` is what callers await.

export type RazorpayCtor = Window['Razorpay']

interface Waiter {
  promise: Promise<RazorpayCtor>
  resolve: (ctor: RazorpayCtor) => void
  reject: (error: Error) => void
}

let waiter: Waiter | null = null

function getWaiter(): Waiter {
  if (waiter !== null) return waiter
  let resolve!: Waiter['resolve']
  let reject!: Waiter['reject']
  const promise = new Promise<RazorpayCtor>((res, rej) => {
    resolve = res
    reject = rej
  })
  promise.catch(() => undefined) // a rejection nobody awaited yet is not an unhandled rejection
  waiter = { promise, resolve, reject }
  return waiter
}

/** Resolves once `window.Razorpay` exists. After a failure the next call waits for a fresh attempt. */
export function loadRazorpay(): Promise<RazorpayCtor> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Razorpay can only load in the browser'))
  if (typeof window.Razorpay !== 'undefined') return Promise.resolve(window.Razorpay)
  return getWaiter().promise
}

export function notifyRazorpayLoaded(): void {
  if (typeof window.Razorpay === 'undefined') {
    notifyRazorpayFailed()
    return
  }
  getWaiter().resolve(window.Razorpay)
  waiter = null
}

export function notifyRazorpayFailed(): void {
  getWaiter().reject(new Error('Razorpay script failed to load'))
  waiter = null
}
