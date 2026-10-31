'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useAccountTarget } from '@/components/layout/PublicAccountLink'
import { isActivePath, type PublicNavItem } from '@/components/layout/PublicNavLinks'
import { Menu } from '@/components/ui/icons/Menu'
import { isWebUrl } from '@/components/ui/linkHref'
import { buttonClassName } from '@/components/ui/buttonStyles'
import { Sheet } from '@/components/ui/overlay/Sheet'
import { cn } from '@/lib/cn'

interface PublicMobileMenuProps {
  /** Primary navigation entries (same list as the desktop nav). */
  items: readonly PublicNavItem[]
  /** Primary call to action, repeated inside the menu as a full-width button. */
  action: PublicNavItem
  /** Accessible name of the navigation landmark inside the sheet. */
  label: string
}

function relFor(href: string) {
  return isWebUrl(href as Route) ? ({ rel: 'noopener noreferrer' } as const) : {}
}

/**
 * Mobile menu island for the public header (below 960px). The ONLY overlay code the (public) group ships
 * (ARCH-001 M3, .dependency-cruiser.cjs MENU_ISLAND_OVERLAY). Sheet (Radix Dialog) supplies the focus trap, Escape,
 * scroll lock, inert background and focus return to the trigger. The trigger is a 44px button named "Menu" (text visible
 * from 480px) with `aria-expanded` and `aria-controls` set by Radix. The menu closes on link click and whenever the pathname changes (also for
 * back/forward navigation), using the "adjust state during render" pattern instead of an effect.
 */
export function PublicMobileMenu({ items, action, label }: PublicMobileMenuProps) {
  const pathname = usePathname()
  const account = useAccountTarget()
  const [open, setOpen] = useState(false)
  const [openedOn, setOpenedOn] = useState(pathname)

  if (openedOn !== pathname) {
    setOpenedOn(pathname)
    if (open) setOpen(false)
  }

  const close = () => setOpen(false)

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Menu"
      side="right"
      closeLabel="Close menu"
      trigger={
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-public px-2 type-button text-ink hover:bg-line md:hidden"
        >
          <Menu />
          {/* Visible from 480px; below that it stays the accessible name so the 320px bar fits on one line. */}
          <span className="sr-only xs:not-sr-only">Menu</span>
        </button>
      }
    >
      <nav aria-label={label} className="flex min-h-full flex-col gap-8">
        <ul className="flex flex-col border-t border-line">
          {items.map((item) => {
            const active = isActivePath(item.href, pathname)
            return (
              <li key={`${item.href}-${item.label}`} className="border-b border-line">
                <Link
                  href={item.href as Route}
                  onClick={close}
                  aria-current={active ? 'page' : undefined}
                  {...relFor(item.href)}
                  className={cn(
                    'flex min-h-12 items-center py-3 font-display text-2xl leading-snug text-ink',
                    'decoration-2 underline-offset-8 hover:text-forest-soft',
                    'aria-[current=page]:underline aria-[current=page]:decoration-copper-dark',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="mt-auto flex flex-col gap-4">
          <Link
            href={action.href as Route}
            onClick={close}
            {...relFor(action.href)}
            className={buttonClassName({
              variant: 'primary',
              size: 'lg',
              fullWidth: true,
              blocked: false,
              loading: false,
            })}
          >
            {action.label}
          </Link>
          <Link
            href={account.href as Route}
            onClick={close}
            aria-current={isActivePath(account.href, pathname) ? 'page' : undefined}
            {...relFor(account.href)}
            className={buttonClassName({
              variant: 'secondary',
              size: 'lg',
              fullWidth: true,
              blocked: false,
              loading: false,
            })}
          >
            {account.label}
          </Link>
        </div>
      </nav>
    </Sheet>
  )
}
