/**
 * User domain of dor_user: IDENTITY and APPLICATION ROLE only. Pure rules (no database), unit-tested directly.
 *
 *   role            DOD application permission (admin · analyst · publisher · viewer): menus and actions, never data
 *   identityIssuer + externalSubject   the SSO identity (Phase 2); both or neither, unique as a pair
 *
 * Data access (which Business Units a user may see) is not part of the user record: it is the user's
 * assignments in dor_user_access, managed by an access manager (dataAccess/dataAccessService.ts). The former
 * level/scope/ownership columns of dor_user stay in the table for rollback but are not read or written.
 */
import { z } from 'zod'

export const ROLES = ['admin', 'analyst', 'publisher', 'viewer'] as const

/** Optional text: '' and whitespace mean "not set" (null). */
const optText = (max: number) => z.preprocess((v) => (typeof v === 'string' && !v.trim() ? null : v), z.string().trim().max(max).nullable().default(null))

const UserBase = {
  username: z.string().trim().regex(/^[A-Za-z0-9._@-]{3,64}$/, 'Username 3–64 karakter: huruf, angka, titik, garis bawah, @ atau -'),
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(120),
  role: z.enum(ROLES),
  identityIssuer: optText(500),
  externalSubject: optText(255),
  active: z.boolean().default(true),
}
const Password = z.string().min(8, 'Password minimal 8 karakter').max(200)

/** strict(): unknown keys (id, password_hash, level/scope fields, …) are rejected, not ignored. */
export const UserCreateSchema = z.object({ ...UserBase, password: Password }).strict()
/** Full replacement of the editable fields; password only when it is being reset. */
export const UserUpdateSchema = z.object({ ...UserBase, password: Password.optional() }).strict()
export type UserCreate = z.infer<typeof UserCreateSchema>
export type UserUpdate = z.infer<typeof UserUpdateSchema>

export interface Problem {
  field: string
  message: string
}

/** SSO identity: both parts or neither; the issuer is an https URL. Username and e-mail are never the key. */
export function ssoProblems(issuer: string | null, subject: string | null): Problem[] {
  if (!issuer && !subject) return []
  if (!issuer) return [{ field: 'identityIssuer', message: 'Identity issuer wajib diisi bersama external subject.' }]
  if (!subject) return [{ field: 'externalSubject', message: 'External subject wajib diisi bersama identity issuer.' }]
  const url = URL.canParse(issuer) ? new URL(issuer) : null
  if (!url || url.protocol !== 'https:' || url.username || url.password) return [{ field: 'identityIssuer', message: 'Identity issuer harus berupa URL https, mis. https://sso.perusahaan.com.' }]
  return []
}
