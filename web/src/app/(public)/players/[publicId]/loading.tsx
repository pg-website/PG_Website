import { Section } from '@/components/layout/Section'
import { Skeleton } from '@/components/ui/feedback/Skeleton'
import { SkeletonRegion } from '@/components/ui/feedback/SkeletonRegion'

export default function Loading() {
  return (
    <Section as="div" space="flush">
      <SkeletonRegion label="Loading player profile" className="flex min-w-0 flex-col gap-6">
        <div className="flex items-center gap-4">
          <Skeleton shape="circle" className="size-24" />
          <Skeleton shape="line" lines={2} className="flex-1" />
        </div>
        <Skeleton shape="card" />
      </SkeletonRegion>
    </Section>
  )
}
