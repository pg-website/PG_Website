import type { Metadata } from 'next'
import { Section } from '@/components/layout/Section'
import { Button } from '@/components/ui/Button'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { Heading } from '@/components/ui/Heading'

export const metadata: Metadata = { title: 'Player not found' }

/** Unknown, hidden or suspended player: one message for all, so a profile's existence is never revealed. */
export default function PlayerNotFound() {
  return (
    <Section as="div" space="flush">
      <div className="flex min-w-0 flex-col items-start gap-4">
        <Eyebrow>Player</Eyebrow>
        <Heading level={1} size="page-intro">
          Player not found
        </Heading>
        <p className="max-w-prose text-muted">This profile does not exist or is not public.</p>
        <Button href="/community" variant="secondary">
          Back to community
        </Button>
      </div>
    </Section>
  )
}
