import { Skeleton } from '@/components/ui/feedback/Skeleton'

// Skeleton grid tiles (mirrors the real grid)
export function AssetsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} shape="block" className="aspect-square w-full" />
      ))}
    </div>
  )
}
