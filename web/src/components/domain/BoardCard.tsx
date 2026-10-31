import type { ReactNode } from 'react'
import { PlayerCard } from '@/components/player/PlayerCard'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { Surface } from '@/components/ui/Surface'
import { Board } from '@/components/ui/icons/Board'
import { Clock } from '@/components/ui/icons/Clock'
import { NO_VALUE } from '@/lib/format/placeholder'
import type { PairingDto } from '@/lib/api/types/event-room'

interface BoardCardProps {
  /** The caller's own published pairing. Display only. */
  pairing: Pick<PairingDto, 'board' | 'colour' | 'round' | 'timeControl'> & {
    opponent: Pick<PairingDto['opponent'], 'displayName' | 'initials'> & {
      rating?: number | null
      /** Opaque profile id; null or missing renders the opponent unlinked. */
      publicId?: string | null
    }
  }
  /** Result action slot: a Button or link rendered by the feature (the card holds no state). */
  action?: ReactNode
  /** Secondary slot below the action, for example "Pairing issue?". */
  secondaryAction?: ReactNode
  className?: string
}

/**
 * Pairing card (COMPONENT-CATALOG): board number in mono (large), opponent, colour as TEXT (never a swatch alone), time
 * control and a slot for the result action. Stacks at 320; the opponent name wraps. Server Component.
 */
export function BoardCard({ pairing, action, secondaryAction, className }: BoardCardProps) {
  const colour = pairing.colour === 'white' ? 'White' : pairing.colour === 'black' ? 'Black' : NO_VALUE
  const name = pairing.opponent.displayName.trim() === '' ? 'Opponent' : pairing.opponent.displayName
  const rating = pairing.opponent.rating
  return (
    <Surface as="section" aria-label={`Board ${pairing.board}, round ${pairing.round}`} className={className}>
      <div className="flex min-w-0 flex-col gap-4 xs:flex-row xs:items-center xs:gap-6">
        <div className="shrink-0">
          <Eyebrow as="p">
            <Board size="sm" className="mr-1 inline align-text-bottom" />
            Board
          </Eyebrow>
          <p className="font-mono text-section leading-none">{pairing.board}</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Eyebrow as="p">Round {pairing.round}</Eyebrow>
          <div className="flex min-w-0 items-center gap-3">
            <PlayerCard
              identity={{
                displayName: name,
                initials: pairing.opponent.initials,
                publicId: pairing.opponent.publicId ?? null,
                rating: null,
                cityChapter: null,
              }}
              className="text-xl"
              trailing={
                rating === null || rating === undefined ? null : (
                  <span className="font-mono text-sm text-muted">{rating}</span>
                )
              }
            />
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span>
              You play <strong className="font-strong text-ink">{colour}</strong>
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock size="sm" />
              {pairing.timeControl.trim() === '' ? NO_VALUE : pairing.timeControl}
            </span>
          </p>
        </div>
      </div>
      {action === undefined && secondaryAction === undefined ? null : (
        <div className="mt-4 flex min-w-0 flex-col gap-3 xs:flex-row xs:flex-wrap">
          {action}
          {secondaryAction}
        </div>
      )}
    </Surface>
  )
}
