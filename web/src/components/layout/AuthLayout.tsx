import type { ReactNode } from 'react'
import { BrandMark } from '@/components/layout/BrandMark'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { Text } from '@/components/ui/Text'

export interface AuthStoryCopy {
  eyebrow?: string
  headline: string
  body: string
}

/** Reference screen 13 (`.auth-static__story`). Screens 14 to 16 may pass their own. */
const DEFAULT_STORY: AuthStoryCopy = {
  eyebrow: 'My PG',
  headline: 'Good games start before the clock.',
  body: 'Your events, pairings, ratings and people in one quiet place.',
}

interface AuthLayoutProps {
  story?: AuthStoryCopy
  /** The form panel: its own h1, the form island and the secondary links. */
  children: ReactNode
}

/**
 * Split auth frame (reference `.auth-static`, RESPONSIVE-BEHAVIOR "Login/auth"). From 960px (`md`): an editorial forest
 * panel (brand, local photo, short copy) on the left, the form centred on the right in a 440px column. Below 960px the
 * story panel is not rendered visibly (`hidden`), so the form is the first thing after the brand mark and nothing adds
 * vertical friction on a phone; its lazy image is never requested there. The page h1 lives in the form panel, so the
 * outline is the same at every width; the story headline is a paragraph. Gutters come from `px-gutter` (20px, 36px from
 * 720px) plus the safe-area insets; `min-w-0` everywhere keeps 320px free of horizontal scroll. Server Component.
 */
export function AuthLayout({ story = DEFAULT_STORY, children }: AuthLayoutProps) {
  return (
    <div className="grid min-w-0 md:min-h-dvh md:grid-cols-2">
      <section
        aria-label="About My PG"
        data-surface="dark"
        className="hidden min-w-0 flex-col justify-between gap-10 surface-dark p-14 md:flex"
      >
        <BrandMark tone="dark" />
        <div className="grid min-w-0 gap-6">
          <div className="grid min-w-0 gap-4">
            {story.eyebrow != null && <Eyebrow>{story.eyebrow}</Eyebrow>}
            <p className="max-w-sm font-display text-section wrap-break-word">{story.headline}</p>
            <Text variant="lead" tone="on-dark" className="max-w-md">
              {story.body}
            </Text>
          </div>
        </div>
        <Text as="p" variant="small" tone="on-dark">
          Good games. Better company.
        </Text>
      </section>

      <div className="flex min-w-0 flex-col px-gutter pt-safe-6 pb-safe-12 md:items-center md:justify-center md:py-12">
        <div className="mb-8 md:hidden">
          <BrandMark />
        </div>
        <div className="w-full max-w-md min-w-0">{children}</div>
      </div>
    </div>
  )
}
