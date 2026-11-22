import { Avatar } from '@/components/ui/Avatar'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { Heading } from '@/components/ui/Heading'
import { Surface } from '@/components/ui/Surface'
import { Section } from '@/components/layout/Section'
import { RATING_POOLS } from '@/lib/api/types/identity'
import type { PublicProfileDto } from '@/lib/api/types/player-profile'

const TITLE_ID = 'player-profile-title'
const POOL_LABEL = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical' } as const

/**
 * Public player profile (PLAN-007; no reference screen exists). Shows only what the player chose to share: name, city
 * chapter, a rating per pool (none when hidden), member-since year and a games count. Never contact data. Server Component.
 */
export function PublicProfile({ player }: { player: PublicProfileDto }) {
  const ratings = RATING_POOLS.flatMap((pool) => {
    const found = player.ratings.find((rating) => rating.pool === pool)
    return found === undefined ? [] : [found]
  })
  return (
    <Section as="div" space="flush">
      <article aria-labelledby={TITLE_ID} className="flex min-w-0 flex-col gap-8">
        <header className="flex min-w-0 items-center gap-4 sm:gap-6">
          <Avatar name={player.displayName} size="lg" decorative />
          <div className="min-w-0">
            <Eyebrow>Player</Eyebrow>
            <Heading level={1} size="page-intro" id={TITLE_ID} className="mt-1 wrap-break-word">
              {player.displayName}
            </Heading>
            {player.cityChapter === null ? null : <p className="text-muted">{player.cityChapter}</p>}
          </div>
        </header>

        <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Surface>
            <dt className="type-eyebrow text-muted">Member since</dt>
            <dd className="mt-2 font-display text-3xl leading-none">{player.memberSince}</dd>
          </Surface>
          <Surface>
            <dt className="type-eyebrow text-muted">Events played</dt>
            <dd className="mt-2 font-display text-3xl leading-none">{player.eventsPlayed}</dd>
          </Surface>
        </dl>

        {ratings.length === 0 ? null : (
          <section aria-labelledby="player-ratings-title" className="min-w-0">
            <Heading level={2} size="panel" id="player-ratings-title" className="mb-4">
              Ratings
            </Heading>
            <ul className="grid min-w-0 gap-4 sm:grid-cols-3">
              {ratings.map((rating) => (
                <li key={rating.pool} className="min-w-0">
                  <Surface>
                    <p className="type-eyebrow text-muted">{POOL_LABEL[rating.pool]}</p>
                    <p className="mt-2 font-mono text-3xl leading-none">{rating.value}</p>
                  </Surface>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </Section>
  )
}
