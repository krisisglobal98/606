/**
 * UI language, chosen on the login page. The source text is the key: en.ts gives the English wording and
 * id.ts the Indonesian wording of source text with English terms; text in neither table shows as written. The language is fixed for the page's lifetime: changing it
 * reloads the page, which is what lets tr() also be used for module-level constants.
 */
import { en } from './en'
import { id } from './id'

export type Language = 'id' | 'en'

const STORAGE_KEY = 'dod.lang'

function readLanguage(): Language {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'en' ? 'en' : 'id'
  } catch {
    return 'id'
  }
}

export const LANGUAGE: Language = readLanguage()
export const LOCALE = LANGUAGE === 'en' ? 'en-US' : 'id-ID'

if (typeof document !== 'undefined') document.documentElement.lang = LANGUAGE

export function setLanguage(next: Language): void {
  if (next === LANGUAGE) return
  localStorage.setItem(STORAGE_KEY, next)
  location.reload()
}

/** The text in the current language; `{0}`, `{1}`… take the arguments in order. */
export function tr(key: string, ...args: unknown[]): string {
  const text = (LANGUAGE === 'en' ? en[key] : id[key]) ?? key
  return args.length ? text.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)])) : text
}
