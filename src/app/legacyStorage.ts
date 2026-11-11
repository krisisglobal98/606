/**
 * Browser data saved before the DOD rename (keys "dor.*") moves to "dod.*", so nobody loses their session or
 * preferences. Imported first in main.tsx: the stores read their keys when they are created.
 */
for (const store of [localStorage, sessionStorage]) {
  for (const key of Object.keys(store).filter((k) => k.startsWith('dor.'))) {
    const next = `dod.${key.slice(4)}`
    if (store.getItem(next) == null) store.setItem(next, store.getItem(key)!)
    store.removeItem(key)
  }
}
