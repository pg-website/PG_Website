'use client'

import { Text } from '@/components/ui/Text'
import type { BuilderStepProps } from '@/features/event-builder/types'

/** Placeholder body of a step that a later task builds. Shows no fields and stores nothing. */
export function StepSlot({ stepId }: BuilderStepProps) {
  return <Text id={`step-slot-${stepId}`}>The fields for this step are added in a later task.</Text>
}
