import { Skeleton } from '@/components/ui/feedback/Skeleton'
import { cn } from '@/lib/cn'

interface PlayerCardSkeletonProps {
  variant?: 'row' | 'compact'
  className?: string
}

/** Loading placeholder with the same height as the card. */
export function PlayerCardSkeleton({ variant = 'row', className }: PlayerCardSkeletonProps) {
  return (
    <div aria-hidden="true" className={cn('flex min-w-0 items-center gap-3', className)}>
      <Skeleton shape="circle" className={variant === 'row' ? 'size-12' : 'size-8'} />
      <Skeleton shape="line" className="max-w-48 flex-1" />
    </div>
  )
}
