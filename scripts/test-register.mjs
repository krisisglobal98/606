// Lets `node --test` run frontend TypeScript modules: resolves the "@/" alias and extensionless imports.
import { register } from 'node:module'
register('./test-resolve.mjs', import.meta.url)
