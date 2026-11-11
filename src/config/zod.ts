import { z } from 'zod'

/**
 * Zod's fast path compiles validators with `new Function`. The app's Content-Security-Policy has no
 * 'unsafe-eval', so turn the compiler (and its eval probe, which a strict CSP reports as a violation)
 * off. Imported first in main.tsx, before any schema parses.
 */
z.config({ jitless: true })
