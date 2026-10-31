import { Skeleton } from '@/components/ui/feedback/Skeleton'

export function SettingsSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton shape="line" />
      <Skeleton shape="line" />
      <Skeleton shape="block" className="h-40 w-full" />
    </div>
  )
}

