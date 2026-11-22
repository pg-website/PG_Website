// TASK-121: the parts of ARCH-001 M6 and M13 that dependency-cruiser cannot see because they depend on file CONTENT.
//   node scripts/check-module-directives.ts            (run by `npm run check:deps`)
//
// 1. Server-only modules start with `import 'server-only'` (lib/data/public, lib/api/server, lib/env/env.server.ts,
//    lib/revalidate, lib/api/adapters/index.server.ts, *.server.ts).
// 2. Client-only locations (lib/api/browser, lib/query, lib/mock/store.browser.ts, adapters/index.browser.ts,
//    features/*) start with 'use client', OR are imported only by 'use client' modules (or by other client-only
//    locations that satisfy the same rule).
// 3. A module that starts with 'use client' may not reach a server-only module through value imports, however deep.
//    This is the transitive walk the ESLint rule (direct imports only) cannot do.
// 4. Dynamic (public) pages (a `[param]` folder) validate the param (isValidSlug / isValidEntityId / isValidPublicId) before the first call
//    into lib/data/public inside each function, and call notFound() (M13). Heuristic: textual order within a top-level
//    function; the real guarantee is the lint rule on serverGet plus the e2e 404 tests.
//
// Type-only imports are erased by the compiler and never count. Tests (*.test.*) and src/test are skipped.
// Only erasable TypeScript is used (Node strips types natively, same as guard-env.ts).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SERVER_ONLY_PATHS: readonly RegExp[] = [
  /^src\/lib\/data\/public\//,
  /^src\/lib\/api\/server\//,
  /^src\/lib\/revalidate\//,
  /^src\/lib\/env\/env\.server\.tsx?$/,
  /^src\/lib\/api\/adapters\/index\.server\.tsx?$/,
  /\.server\.tsx?$/,
]

export const CLIENT_ONLY_PATHS: readonly RegExp[] = [
  /^src\/features\//,
  /^src\/lib\/api\/browser\//,
  /^src\/lib\/query\//,
  /^src\/lib\/mock\/store\.browser\.tsx?$/,
  /^src\/lib\/api\/adapters\/index\.browser\.tsx?$/,
]

const SERVER_ONLY_PACKAGES = new Set(['server-only', 'next/headers'])
const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']
const IS_TEST = /\.test\.tsx?$|^src\/test\//
const isSource = (rel: string) => /\.tsx?$/.test(rel) && !/\.d\.ts$/.test(rel) && !IS_TEST.test(rel)

type Imports = { value: string[]; typeOnly: string[] }
type Module = { rel: string; text: string; directive: boolean; serverOnlyFirst: boolean; imports: Imports }

/** Strips block and line comments (not inside strings; good enough for the import header of a module). */
function stripLeadingTrivia(text: string): string {
  let rest = text.replace(/^﻿/, '')
  for (;;) {
    const next = rest
      .replace(/^\s+/, '')
      .replace(/^\/\/[^\n]*/, '')
      .replace(/^\/\*[\s\S]*?\*\//, '')
    if (next === rest) return rest.replace(/^\s+/, '')
    rest = next
  }
}

export function hasUseClientDirective(text: string): boolean {
  return /^(['"])use client\1\s*;?/.test(stripLeadingTrivia(text))
}

/** True when the first statement is `import 'server-only'` (a 'use client' directive may not precede it: it would be a contradiction). */
export function startsWithServerOnly(text: string): boolean {
  return /^import\s+(['"])server-only\1\s*;?/.test(stripLeadingTrivia(text))
}

export function scanImports(text: string): Imports {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1')
  const value: string[] = []
  const typeOnly: string[] = []
  // import x from 'y' / import 'y' / export ... from 'y' (multi-line braces allowed)
  for (const m of code.matchAll(
    /(?:^|[;\n}])\s*(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?(['"])([^'"\n]+)\3/g,
  )) {
    const spec = m[4]
    if (spec === undefined) continue
    // `import { type A } from` still pulls the module at runtime under verbatimModuleSyntax, so only `import type` is erased.
    ;(m[2] === undefined ? value : typeOnly).push(spec)
  }
  for (const m of code.matchAll(/\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g)) if (m[2] !== undefined) value.push(m[2])
  return { value, typeOnly }
}

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
}

export function loadModules(root: string): Map<string, Module> {
  const files: string[] = []
  walk(join(root, 'src'), files)
  const modules = new Map<string, Module>()
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/')
    if (!isSource(rel)) continue
    const text = readFileSync(file, 'utf8')
    modules.set(rel, {
      rel,
      text,
      directive: hasUseClientDirective(text),
      serverOnlyFirst: startsWithServerOnly(text),
      imports: scanImports(text),
    })
  }
  return modules
}

function resolveSpec(spec: string, from: string, modules: Map<string, Module>): string | undefined {
  let base: string
  if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`
  else if (spec.startsWith('./') || spec.startsWith('../')) base = join(dirname(from), spec).split(sep).join('/')
  else return undefined
  base = base.replace(/\\/g, '/')
  if (modules.has(base)) return base
  return EXTENSIONS.map((ext) => base + ext).find((candidate) => modules.has(candidate))
}

const isServerOnlyModule = (m: Module) => SERVER_ONLY_PATHS.some((re) => re.test(m.rel)) || m.serverOnlyFirst

function reachesServerOnlyPackage(m: Module): string | undefined {
  return m.imports.value.find((spec) => SERVER_ONLY_PACKAGES.has(spec))
}

export function checkDirectives(root: string): string[] {
  const modules = loadModules(root)
  const problems: string[] = []

  // 1. server-only modules start with the guard import.
  for (const m of modules.values()) {
    if (SERVER_ONLY_PATHS.some((re) => re.test(m.rel)) && !m.serverOnlyFirst) {
      problems.push(`${m.rel}: M6 server-only module must start with \`import 'server-only'\``)
    }
    if (m.serverOnlyFirst && m.directive) problems.push(`${m.rel}: cannot be both server-only and 'use client'`)
  }

  // 2. client-only locations: directive, or imported only by client modules.
  const importers = new Map<string, string[]>()
  for (const m of modules.values()) {
    for (const spec of m.imports.value) {
      const target = resolveSpec(spec, m.rel, modules)
      if (target !== undefined) importers.set(target, [...(importers.get(target) ?? []), m.rel])
    }
  }
  const isClientLocation = (rel: string) => CLIENT_ONLY_PATHS.some((re) => re.test(rel))
  for (const m of modules.values()) {
    if (!isClientLocation(m.rel) || m.directive) continue
    const parents = importers.get(m.rel) ?? []
    const bad = parents.filter((p) => !(modules.get(p)?.directive === true || isClientLocation(p)))
    if (bad.length > 0) {
      problems.push(
        `${m.rel}: M6 client-only module must start with 'use client' or be imported only by 'use client' modules (imported by ${bad.join(', ')})`,
      )
    }
  }

  // 3. transitive: 'use client' -> ... -> server-only.
  for (const root0 of modules.values()) {
    if (!root0.directive) continue
    const parent = new Map<string, string | null>([[root0.rel, null]])
    const queue = [root0.rel]
    while (queue.length > 0) {
      const current = queue.shift() as string
      const m = modules.get(current) as Module
      const pkg = reachesServerOnlyPackage(m)
      if (pkg !== undefined && current !== root0.rel) {
        problems.push(`${root0.rel}: 'use client' reaches server-only package "${pkg}" via ${chain(parent, current)}`)
      } else if (pkg !== undefined) {
        problems.push(`${root0.rel}: 'use client' module imports server-only package "${pkg}"`)
      }
      if (current !== root0.rel && isServerOnlyModule(m)) {
        problems.push(`${root0.rel}: 'use client' reaches server-only module via ${chain(parent, current)}`)
        continue // do not report everything behind it
      }
      for (const spec of m.imports.value) {
        const target = resolveSpec(spec, m.rel, modules)
        if (target !== undefined && !parent.has(target)) {
          parent.set(target, current)
          queue.push(target)
        }
      }
    }
  }

  // 3b. SEC-001 F-04: the session hint is the one auth module (public) code may import, so it must not import the token
  //     store (lib/api/browser/*) itself, by any path spelling. (The graph rule f04-session-hint-isolated covers the
  //     transitive case; this is the textual belt and braces, including type-only imports and dynamic imports.)
  for (const m of modules.values()) {
    if (!/^src\/lib\/auth\/session-hint\.tsx?$/.test(m.rel)) continue
    for (const spec of [...m.imports.value, ...m.imports.typeOnly]) {
      const target = resolveSpec(spec, m.rel, modules)
      if (
        /(^|\/)api\/browser(\/|$)/.test(spec) ||
        (target !== undefined && target.startsWith('src/lib/api/browser/'))
      ) {
        problems.push(`${m.rel}: F-04 the session hint must not import the token store (${spec})`)
      }
    }
  }

  // 4. M13 for dynamic (public) pages.
  for (const m of modules.values()) {
    if (!/^src\/app\/\(public\)\/.*\[[^\]]+\]\/(page|route)\.tsx?$/.test(m.rel)) continue
    problems.push(...checkParamValidation(m))
  }

  return problems.sort()
}

function chain(parent: Map<string, string | null>, end: string): string {
  const path: string[] = []
  for (let at: string | null | undefined = end; at != null; at = parent.get(at)) path.unshift(at)
  return path.join(' -> ')
}

function checkParamValidation(m: Module): string[] {
  const problems: string[] = []
  const dataNames = new Set<string>()
  for (const imp of m.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*(['"])@\/lib\/data\/public\/[^'"]+\2/g)) {
    for (const part of (imp[1] ?? '').split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
      if (name) dataNames.add(name.replace(/^type\s+/, ''))
    }
  }
  if (dataNames.size === 0) return problems // placeholder page: nothing fetched yet
  if (!/\bnotFound\s*\(/.test(m.text))
    problems.push(`${m.rel}: M13 dynamic public page must call notFound() on an invalid param`)
  const chunks = m.text.split(/\n(?=(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b)/)
  for (const chunk of chunks) {
    const calls = [...dataNames].map((n) => chunk.search(new RegExp(`\\b${n}\\s*\\(`))).filter((i) => i >= 0)
    if (calls.length === 0) continue
    const firstCall = Math.min(...calls)
    const validated = chunk.search(/\bisValid(?:Slug|EntityId|PublicId)\s*\(/)
    if (validated < 0 || validated > firstCall) {
      const fn = /function\s+(\w+)/.exec(chunk)?.[1] ?? '(anonymous)'
      problems.push(
        `${m.rel}: M13 ${fn}() calls lib/data/public before validating the route param (isValidSlug / isValidEntityId / isValidPublicId)`,
      )
    }
  }
  return problems
}

// ---------- CLI ----------
const here = dirname(fileURLToPath(import.meta.url))
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] !== undefined ? resolve(process.argv[2]) : resolve(here, '..')
  if (!existsSync(join(root, 'src'))) {
    console.error(`check-module-directives: no src/ under ${root}`)
    process.exit(2)
  }
  const problems = checkDirectives(root)
  if (problems.length > 0) {
    console.error('Module directive check failed (ARCH-001 M6, M13):')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`check-module-directives: ok (${loadModules(root).size} modules)`)
}
