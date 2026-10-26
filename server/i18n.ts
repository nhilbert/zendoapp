import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locale } from '../src/domain/types.ts'

/**
 * The app's translation files (src/i18n/*.json) for pages and screens the server renders itself
 * (TRMNL). Supports what those strings use: nested keys, {{name}} placeholders and _one/_other plurals.
 */
type Tree = { [key: string]: string | Tree }

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n')
const cache = new Map<Locale, Tree>()
const load = (locale: Locale): Tree => {
  if (!cache.has(locale)) cache.set(locale, JSON.parse(readFileSync(path.join(DIR, `${locale}.json`), 'utf8')) as Tree)
  return cache.get(locale)!
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string

export function translator(locale: Locale): Translate {
  const lookup = (tree: Tree, key: string): string | undefined => {
    let node: string | Tree | undefined = tree
    for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined
    return typeof node === 'string' ? node : undefined
  }
  const plural = new Intl.PluralRules(locale)
  return (key, vars = {}) => {
    const keys = typeof vars.count === 'number' ? [`${key}_${plural.select(vars.count)}`, `${key}_other`, key] : [key]
    let text: string | undefined
    for (const tree of [load(locale), load('en')]) for (const k of keys) text ??= lookup(tree, k)
    return (text ?? key).replace(/\{\{(\w+)\}\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
  }
}
