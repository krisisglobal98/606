/**
 * Client address handling. The address comes from Fastify's `req.ip`, which only follows X-Forwarded-For
 * through the proxies listed in DOD_TRUSTED_PROXIES (see config.ts); without trusted proxies it is the
 * TCP peer. Addresses are normalised so one client never maps to several keys.
 */
import { isIPv4, isIPv6 } from 'node:net'
import type { FastifyRequest } from 'fastify'

const MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
/** `1.2.3.4:50789` and `[2001:db8::7]:50789`: IIS ARR adds the client's port to X-Forwarded-For by default. */
const V4_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/
const V6_PORT = /^\[([^\]]+)\]:\d{1,5}$/

/**
 * Canonical form of an IP address, or null when the value is not one: lower case, a port (`1.2.3.4:50789`,
 * `[::1]:50789`, as IIS ARR forwards it by default) brackets and IPv6 zone removed, IPv6 compressed, and
 * IPv4-mapped IPv6 (`::ffff:1.2.3.4`) reduced to plain IPv4. Without the port rule every visitor behind ARR would
 * become the proxy itself (one "device" and one login-throttle bucket for everyone).
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.trim().toLowerCase()
  s = V4_PORT.exec(s)?.[1] ?? V6_PORT.exec(s)?.[1] ?? s
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  if (s.startsWith('::ffff:') && isIPv4(s.slice(7))) return s.slice(7)
  if (isIPv4(s)) return s
  if (!isIPv6(s)) return null
  const canonical = new URL(`http://[${s}]/`).hostname.slice(1, -1)
  const mapped = MAPPED_HEX.exec(canonical)
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16), lo = parseInt(mapped[2]!, 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  return canonical
}

/**
 * Address used to identify the client (login throttle). A forwarded value that is not a valid IP (sent by a
 * misbehaving proxy) is not trusted: the TCP peer is used instead.
 */
export function clientIp(req: FastifyRequest): string {
  return normalizeIp(req.ip) ?? normalizeIp(req.socket?.remoteAddress) ?? 'unknown'
}
