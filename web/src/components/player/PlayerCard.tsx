import Link from 'next/link'
import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import type { PublicIdentity } from '@/lib/api/types/identity'
import { cn } from '@/lib/cn'
import { playerProfileHref } from '@/lib/routes/routes'

interface PlayerCardProps {
  /** Public identity as the API returns it. `publicId` null renders the card unlinked. */
  identity: PublicIdentity
  /** `row` is a list row (avatar 48px); `compact` is for tables and dense lists (avatar 32px). */
  variant?: 'row' | 'compact'
  /** Adds the "(you)" mark. The card stays linked. */
  isYou?: boolean
  /** Right-hand slot: score, games count. Kept outside the link so it is not read as part of the link name. */
  trailing?: ReactNode
  /** Show the rating next to the name (default false). */
  showRating?: boolean
  /** Show the city chapter under the name (default false). */
  showCity?: boolean
  /** Layout additions only. */
  className?: string
}

/**
 * Shared player card (PLAN-007). Avatar, name and optional rating/city. With a `publicId` the identity part is one link
 * to `/players/{publicId}` named "View profile of X"; without one it is plain text with no link and no hover effect.
 * Server Component: no hooks, no client directive.
 */
export function PlayerCard({
  identity,
  variant = 'row',
  isYou = false,
  trailing,
  showRating = false,
  showCity = false,
  className,
}: PlayerCardProps) {
  const { displayName, publicId, rating, cityChapter } = identity
  const body = (
    <>
      <Avatar name={displayName} size={variant === 'row' ? 'md' : 'sm'} decorative />
      <span className="min-w-0 flex-1">
        <span className="block font-strong wrap-break-word">
          {displayName}
          {isYou ? <strong className="font-strong"> (you)</strong> : null}
          {showRating && rating !== null ? <span className="font-mono text-sm text-muted"> {rating.value}</span> : null}
        </span>
        {showCity && cityChapter !== null ? <span className="block text-sm text-muted">{cityChapter}</span> : null}
      </span>
    </>
  )
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      {publicId === null ? (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      ) : (
        <Link
          href={playerProfileHref(publicId)}
          aria-label={`View profile of ${displayName}`}
          className="tap flex min-w-0 flex-1 items-center gap-3 hover:underline"
        >
          {body}
        </Link>
      )}
      {trailing === undefined ? null : <span className="shrink-0">{trailing}</span>}
    </div>
  )
}
