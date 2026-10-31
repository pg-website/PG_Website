import type { ReactNode } from 'react'
import { Heading } from '@/components/ui/Heading'
import { Text } from '@/components/ui/Text'

export function SectionShell({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby="settings-section-title" className="grid gap-5">
      <div>
        <Heading level={2} size="panel" id="settings-section-title">
          {title}
        </Heading>
        {intro === undefined ? null : (
          <Text variant="small" className="mt-1">
            {intro}
          </Text>
        )}
      </div>
      {children}
    </section>
  )
}
