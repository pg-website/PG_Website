import { Skeleton } from '@/components/ui/feedback/Skeleton'

export function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton shape="block" className="h-8 w-1/2" />
      <Skeleton shape="block" className="h-40 w-full" />
    </div>
  )
}
