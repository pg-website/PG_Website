import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { envPublic } from '@/lib/env/env.public'
import { fontVariables } from '@/lib/fonts/fonts'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(envPublic.SITE_URL),
  title: { default: "Pawn's Gambit", template: "%s | Pawn's Gambit" },
  // Safe default: non-public groups stay out of the index. (public) overrides this in its own layout (TASK-013).
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

// Root layout reads no cookies/headers/searchParams so (public) stays prerenderable.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  )
}
