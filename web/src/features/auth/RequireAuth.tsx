'use client'

import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MainLandmark } from '@/components/layout/MainLandmark'
import { MustChangePasswordGate } from '@/components/layout/MustChangePasswordGate'
import { RouteLoading } from '@/components/layout/RouteLoading'
import { ErrorState } from '@/components/ui/feedback/ErrorState'
import { loginPath, safeRedirect } from '@/lib/security/safe-redirect'
import { consumeExplicitSignOut } from '@/features/auth/explicit-sign-out'
import { currentPath, rememberReturnTo } from '@/features/auth/return-to'
import { useAuthActions, useAuthSelector, useAuthStatus, useAuthUser } from '@/features/auth/useAuth'

interface RequireAuthProps {
  /** The protected content. Rendered only once the session is confirmed (`signed-in`). */
  children: ReactNode
  /**
   * Wrap the waiting states (skeleton, error) in the page <main>. Set it when the protected content supplies its own
   * <main> (the player shell renders <main> only for a confirmed session); leave it off when the layout already has one.
   */
  ownLandmark?: boolean
}

/**
 * Signed-in gate for the (app) and (admin) layouts (TASK-024; ARCH-001 12.4, 12.5). UX only: the backend authorises
 * every request; tokens live in the browser, so no proxy or server check is possible.
 *
 *   loading               skeleton, never the children (server render and first client render are always `loading`)
 *   loading + error       the bootstrap or `refreshUser` failed for a reason other than "no session" (offline, 5xx):
 *                         ErrorState with a retry that calls `refreshUser`; the session may still be valid
 *   signed-out            replaces the URL with `/login?returnTo=<safe current path>` and shows the skeleton while
 *                         navigating. On a cold visit it also records the return-to intent. Session-expired restore:
 *                         the controller recorded the path when the session ended; sign-in takes it (single use)
 *   signed-in             the children
 */
export function RequireAuth({ children, ownLandmark = false }: RequireAuthProps): ReactNode {
  const frame = (node: ReactNode): ReactNode => (ownLandmark ? <MainLandmark>{node}</MainLandmark> : node)
  const status = useAuthStatus()
  // A reference taken from the state, so the selector stays stable (re-renders only when the error itself changes).
  const error = useAuthSelector((state) => (state.status === 'loading' ? state.error : null))
  const user = useAuthUser()
  const { refreshUser, logout } = useAuthActions()
  const router = useRouter()
  const [retrying, setRetrying] = useState(false)
  // Whether this mount has seen a confirmed session. Read in effects only (RBP rerender-use-ref-transient-values).
  const wasSignedIn = useRef(false)

  useEffect(() => {
    if (status === 'signed-in') {
      wasSignedIn.current = true
      return
    }
    if (status !== 'signed-out') return
    // Explicit sign-out in this tab: the sign-out button navigates itself (to /login with a toast). Don't race it
    // with a /login?returnTo= redirect, and don't offer the previous user's page to the next person at this screen.
    if (wasSignedIn.current && consumeExplicitSignOut()) return
    const returnTo = safeRedirect(currentPath())
    // Cold visit: record the intent here (it survives an OAuth round trip). After a session in this mount, the
    // controller already recorded it on a session end and deliberately cleared it on an explicit logout; writing it
    // again would hand the next user of this tab the previous user's page.
    if (returnTo !== undefined && !wasSignedIn.current) rememberReturnTo(returnTo)
    router.replace(loginPath(returnTo) as Route)
  }, [status, router])

  if (status === 'signed-in') {
    // PLAN-012: gate admin-created accounts until they change their temporary password.
    if (user?.mustChangePassword === true) {
      const handleLogout = (): void => {
        void logout().then(() => {
          router.replace('/login' as Route)
        })
      }
      return (
        <MustChangePasswordGate
          user={{ name: user.name, email: user.email, mustChangePassword: true }}
          onLoggedOut={handleLogout}
        />
      )
    }
    return children
  }

  if (status === 'loading' && error !== null && error !== undefined) {
    const retry = (): void => {
      setRetrying(true)
      void refreshUser().finally(() => {
        setRetrying(false)
      })
    }
    return frame(
      <div className="shell py-12">
        <ErrorState error={error} action="check your sign-in" onRetry={retry} retrying={retrying} headingLevel={1} />
      </div>,
    )
  }

  // The shell (and its <main>) only renders for a confirmed session, so the waiting states supply their own landmark.
  return frame(<RouteLoading />)
}
