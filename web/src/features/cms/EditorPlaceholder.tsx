import { Surface } from '@/components/ui/Surface'
import { Text } from '@/components/ui/Text'

/** Slot shown until the typed field editors (CMS-F3 / CMS-F5) are built. */
export function EditorPlaceholder({ label }: { label: string }) {
  return (
    <Surface padding="lg">
      <Text>
        The field editor for {label} is not built yet. Saving and publishing are wired to the live backend and will work
        as soon as the editor is in place.
      </Text>
    </Surface>
  )
}
