import { Skeleton } from '@/components/ui/feedback/Skeleton'

export function PickerGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} shape="block" className="aspect-square w-full" />
      ))}
    </div>
  )
}
