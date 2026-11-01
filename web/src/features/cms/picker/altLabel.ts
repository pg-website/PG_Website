/** Alt text as the picker shows it. Always visible, so an admin can tell images apart and spot missing alt. */
export function altLabel(asset: { alt: string | null; decorative: boolean }): string {
  if (asset.decorative) return 'Decorative image'
  return asset.alt === null || asset.alt === '' ? 'No alt text' : asset.alt
}
