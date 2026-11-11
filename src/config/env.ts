/** Frontend-safe runtime configuration. Never put secrets here: every VITE_ value ships to the browser. */
export const env = {
  appName: import.meta.env.VITE_APP_NAME || 'Daily Operation Discovery',
  appEnv: import.meta.env.VITE_APP_ENV || import.meta.env.MODE,
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, ''),
  version: '0.2.0',
} as const
