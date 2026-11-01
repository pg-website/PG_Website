'use client'

import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/ui/overlay/ConfirmDialog'

interface PendingLeave {
  run: () => void
}

/** Same-origin page change caused by a plain left click on a link, or null. */
function navigationTarget(event: MouseEvent): Route | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null
  }
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (anchor === null) return null
  const target = anchor.getAttribute('target')
  if ((target !== null && target !== '_self') || anchor.hasAttribute('download')) return null
  const url = new URL(anchor.getAttribute('href') ?? '', window.location.href)
  if (url.origin !== window.location.origin) return null
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null
  return `${url.pathname}${url.search}${url.hash}` as Route
}

/**
 * Unsaved-changes guard for the CMS editor (CMS-F2). Covers two in-app doors with a confirm dialog:
 *   1. any same-origin link click while `dirty` (capture-phase listener, then `router.push` on "Leave");
 *   2. in-page moves the page itself starts (picking another section, Back to list) through `requestLeave(proceed)`.
 * Closing or reloading the tab is covered by SaveBar's own `beforeunload` warning, so it is not repeated here. The browser
 * Back button cannot be intercepted by the App Router. Render `guard` once in the page.
 */
export function useDirtyGuard(dirty: boolean): {
  guard: ReactNode
  /** Runs `proceed` now when clean, or after the user confirms when dirty. */
  requestLeave: (proceed: () => void) => void
} {
  const router = useRouter()
  const [pending, setPending] = useState<PendingLeave | null>(null)

  useEffect(() => {
    if (!dirty) return undefined
    const onClick = (event: MouseEvent) => {
      const route = navigationTarget(event)
      if (route === null) return
      event.preventDefault()
      event.stopPropagation()
      setPending({ run: () => router.push(route) })
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, router])

  const requestLeave = useCallback(
    (proceed: () => void) => {
      if (dirty) setPending({ run: proceed })
      else proceed()
    },
    [dirty],
  )

  const guard = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null)
      }}
      onConfirm={() => {
        const leave = pending
        setPending(null)
        leave?.run()
      }}
      title="Leave without saving?"
      consequence="You have changes that are not saved. If you leave now, they will be lost."
      confirmLabel="Leave"
      cancelLabel="Stay and keep editing"
      destructive
    />
  )

  return { guard, requestLeave }
}
