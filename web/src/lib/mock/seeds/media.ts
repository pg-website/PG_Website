import type { MediaCollection, MediaRef } from '@/lib/api/types/media'
import type { Focal } from '@/lib/api/types/primitives'

// Immutable media seeds. Local neutral tiles under /placeholders only: no hot links, no real photography (AC-107).

const TILES = {
  '1x1': { src: '/placeholders/tile-1x1.png', width: 800, height: 800 },
  '4x3': { src: '/placeholders/tile-4x3.png', width: 1200, height: 900 },
  '3x2': { src: '/placeholders/tile-3x2.png', width: 1200, height: 800 },
  '16x9': { src: '/placeholders/tile-16x9.png', width: 1600, height: 900 },
  '4x5': { src: '/placeholders/tile-4x5.png', width: 800, height: 1000 },
} as const

export type TileName = keyof typeof TILES

export function mockImage(tile: TileName, alt: string): MediaRef {
  return { ...TILES[tile], decorative: false, alt, focal: { x: 0.5, y: 0.5 } }
}

/**
 * Home slot images (HOME-01, HOME-PAGE-PLAN 5, Addendum A1.4 Q6): one distinct local file per slot so no photo repeats
 * within a viewport. Sizes and blur data URLs are the ones scripts/gen-placeholders.mjs writes and prints (HOME_IMAGES
 * there); rerun it with --check after changing either side. Production images are PG photography from the CMS.
 */
const HOME_IMAGES = {
  hero: {
    src: '/assets/home-hero-players-at-board.avif',
    width: 2200,
    height: 2750,
    blurDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIElEQVR42mN4dWEPVsTEwMSMFTH9Z2LGivDpwI6oaAcAFH0st3nCjIoAAAAASUVORK5CYII=',
  },
  card1: {
    src: '/placeholders/home-card-1.png',
    width: 960,
    height: 720,
    blurDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAHUlEQVR42mP48v4ZVsT0/88vrIjp3+9fWNGA6gAA5rC7v1DWZA8AAAAASUVORK5CYII=',
  },
  card2: {
    src: '/placeholders/home-card-2.png',
    width: 960,
    height: 720,
    blurDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIklEQVR42mP4/eMTVsT0/esXrIjp27cvWBE+HZ+xIiraAQAF6Lgvon2TBgAAAABJRU5ErkJggg==',
  },
  card3: {
    src: '/placeholders/home-card-3.png',
    width: 960,
    height: 720,
    blurDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAHUlEQVR42mO4OKsUK2Ji4uDGjkiXYOTkwYqoaAcAmPwTr6K2HPAAAAAASUVORK5CYII=',
  },
  firstVisit: {
    src: '/placeholders/home-first-visit.png',
    width: 1200,
    height: 900,
    blurDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAJElEQVR42mN4fu8CVsT099tnrIjp7/fPWBFuHX++fcaKqGgHAKtatw8PEJF2AAAAAElFTkSuQmCC',
  },
  stands: {
    src: '/placeholders/home-stands.png',
    width: 960,
    height: 1200,
    blurDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIUlEQVR42mPwTAjCiph+//yFFTH9wgFw6/j96xdWREU7AN6bq/+Kyld/AAAAAElFTkSuQmCC',
  },
  story: {
    src: '/placeholders/home-story.png',
    width: 1200,
    height: 900,
    blurDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIElEQVR42mO4d/kwVsT0Gwdg+oUD4Nbx+/cvrIiKdgAApKq4L18G3OoAAAAASUVORK5CYII=',
  },
  finalCta: {
    src: '/placeholders/home-final-cta.png',
    width: 1920,
    height: 1080,
    blurDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAIUlEQVR42mMwdLHAipj+/P6DFTH9/fMHK8Ktg3QJku0AAH1kqr8U9pggAAAAAElFTkSuQmCC',
  },
} as const

export type HomeImageName = keyof typeof HOME_IMAGES

/** A Home slot image with real alt text (describes the scene) and an explicit focal point (required, F-14). */
export function homeImage(name: HomeImageName, alt: string, focal: Focal): MediaRef {
  return { ...HOME_IMAGES[name], decorative: false, alt, focal: { ...focal } }
}

export function mockCollection(items: readonly MediaRef[]): MediaCollection {
  return { mode: items.length > 1 ? 'carousel' : 'static', autoplay: false, intervalMs: 6000, items: [...items] }
}
