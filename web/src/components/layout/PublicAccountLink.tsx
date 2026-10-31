'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useSyncExternalStore } from 'react'
import type { UserRole } from '@/lib/api/types/auth'
import { readSessionHint, subscribeSessionHint } from '@/lib/auth/session-hint'

// Account link for the public header (HOME-PAGE-PLAN decision 5, TASK-023). Reads only the non-secret role hint written at
// sign-in (lib/auth/session-hint), never the token store. The server render and the first client render both show "Log in",
// so the markup stays prerenderable and hydration matches; the hint is read after hydration.

const LOGIN = { label: 'Log in', href: '/login' } as const
const PLAYER = { label: 'My PG', href: '/app' } as const
const ADMIN = { label: 'Admin', href: '/admin' } as const

function subscribe(listener: () => void): () => void {
  return subscribeSessionHint(() => {
    listener()
  })
}

// The snapshot must be a stable value: readSessionHint() returns a new object on each call, which makes
// useSyncExternalStore re-render forever. The role string is a primitive, so equal roles compare equal.
function getSnapshot(): UserRole | null {
  return readSessionHint()?.role ?? null
}

function getServerSnapshot(): UserRole | null {
  return null
}

const linkClass =
  'tap hidden text-sm whitespace-nowrap text-ink-soft underline-offset-4 hover:text-ink hover:underline md:inline-flex'

/** The account destination for the stored role hint: "Admin", "My PG" or "Log in". */
export function useAccountTarget(): { label: string; href: string } {
  const role = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return role === null ? LOGIN : role === 'admin' ? ADMIN : PLAYER
}

/** Desktop account link. */
export function PublicAccountLink() {
  const target = useAccountTarget()
  return (
    <Link href={target.href as Route} className={linkClass}>
      {target.label}
    </Link>
  )
}
