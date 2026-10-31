// TASK-032: writes the local neutral placeholder tiles under public/placeholders/ and prints the tiny blur data URL
// used by src/components/ui/media/placeholders.ts. Node built-ins only (zlib), no new dependency.
// HOME-01: also writes the eight Home slot images (home-*.png), each a distinct palette-toned gradient, and prints the
// per-image blur data URL that src/lib/mock/seeds/media.ts copies into its HOME_IMAGES table.
//   node scripts/gen-placeholders.mjs          write the files and print the blur constants
//   node scripts/gen-placeholders.mjs --check  exit 1 if a committed file differs from what this script produces
//
// next/image has dangerouslyAllowSVG: false, so the tiles are PNG. Flat vertical gradient from the sand token to the
// paper-deep token (the reference `.media-frame--empty` look), no text and no people. Colours are duplicated here
// because scripts cannot read CSS tokens; src/components/ui/media/placeholders.test.ts keeps them honest.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public', 'placeholders')

export const TOP = [0xe7, 0xde, 0xd0] // --color-sand
export const BOTTOM = [0xde, 0xd3, 0xc3] // --color-paper-deep

/** Theme palette (src/styles/theme.css) used by the Home images. Copied bytes, same rule as TOP/BOTTOM. */
const PALETTE = {
  parchment: [0xf4, 0xef, 0xe6],
  parchmentSoft: [0xfb, 0xf8, 0xf2],
  sand: TOP,
  paperDeep: BOTTOM,
  stone: [0xb9, 0xae, 0x9d],
  copperPale: [0xea, 0xd0, 0xbc],
  copperSoft: [0xd1, 0x9a, 0x75],
  forest: [0x24, 0x32, 0x28],
  forestDark: [0x17, 0x23, 0x1c],
  forestSoft: [0x31, 0x44, 0x38],
  forestMuted: [0x49, 0x60, 0x52],
}

const WIDTH = 960
/** name -> [ratio width, ratio height]. Heights are WIDTH * h / w, rounded. */
export const TILES = {
  'tile-1x1.png': [1, 1],
  'tile-4x3.png': [4, 3],
  'tile-3x2.png': [3, 2],
  'tile-16x9.png': [16, 9],
  'tile-4x5.png': [4, 5],
}

/**
 * Home slot images (HOME-PAGE-PLAN 5, Addendum A1.4 Q6): one distinct file per slot, sized for the slot and no larger.
 * name -> { width, height, top, bottom }. Hero is a 5:4 source (cropped to 4:5 on mobile via the focal point), cards,
 * first visit and story 4:3, stands 4:5, final CTA 16:9 full bleed. Dark tones for the forest band and the final CTA.
 */
export const HOME_IMAGES = {
  'home-card-1.png': { width: 960, height: 720, top: PALETTE.parchment, bottom: PALETTE.copperPale },
  'home-card-2.png': { width: 960, height: 720, top: PALETTE.parchmentSoft, bottom: PALETTE.stone },
  'home-card-3.png': { width: 960, height: 720, top: PALETTE.copperSoft, bottom: PALETTE.paperDeep },
  'home-first-visit.png': { width: 1200, height: 900, top: PALETTE.sand, bottom: PALETTE.copperSoft },
  'home-stands.png': { width: 960, height: 1200, top: PALETTE.forestMuted, bottom: PALETTE.forest },
  'home-story.png': { width: 1200, height: 900, top: PALETTE.paperDeep, bottom: PALETTE.stone },
  'home-final-cta.png': { width: 1920, height: 1080, top: PALETTE.forestSoft, bottom: PALETTE.forestDark },
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * Opaque RGB PNG with a vertical gradient from `top` to `bottom` (default: the neutral tile tones). Filter 0 on the
 * first row and filter 2 (Up) after, which compresses well.
 */
export function gradientPng(width, height, top = TOP, bottom = BOTTOM) {
  const rowLength = 1 + width * 3
  const raw = Buffer.alloc(rowLength * height)
  let previous = null
  for (let y = 0; y < height; y += 1) {
    const t = height === 1 ? 0 : y / (height - 1)
    const pixel = top.map((from, i) => Math.round(from + ((bottom[i] ?? from) - from) * t))
    const row = Buffer.alloc(width * 3)
    for (let x = 0; x < width; x += 1) row.set(pixel, x * 3)
    const offset = y * rowLength
    if (previous === null) {
      raw[offset] = 0
      row.copy(raw, offset + 1)
    } else {
      raw[offset] = 2
      for (let i = 0; i < row.length; i += 1) raw[offset + 1 + i] = ((row[i] ?? 0) - (previous[i] ?? 0)) & 0xff
    }
    previous = row
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export function blurDataUrl(top = TOP, bottom = BOTTOM) {
  return `data:image/png;base64,${gradientPng(8, 8, top, bottom).toString('base64')}`
}

function main() {
  const check = process.argv.includes('--check')
  if (!check) mkdirSync(outDir, { recursive: true })
  let drift = false
  const files = [
    ...Object.entries(TILES).map(([name, [w, h]]) => ({ name, png: gradientPng(WIDTH, Math.round((WIDTH * h) / w)) })),
    ...Object.entries(HOME_IMAGES).map(([name, { width, height, top, bottom }]) => ({
      name,
      png: gradientPng(width, height, top, bottom),
    })),
  ]
  for (const { name, png } of files) {
    const target = resolve(outDir, name)
    if (check) {
      if (!existsSync(target) || !readFileSync(target).equals(png)) {
        drift = true
        console.error(`out of date: public/placeholders/${name}`)
      }
    } else {
      writeFileSync(target, png)
      console.log(`wrote public/placeholders/${name} (${png.length} bytes)`)
    }
  }
  console.log(`blurDataUrl: ${blurDataUrl()}`)
  for (const [name, { top, bottom }] of Object.entries(HOME_IMAGES)) console.log(`${name}: ${blurDataUrl(top, bottom)}`)
  if (drift) process.exit(1)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
