/**
 * DOD (Daily Operation Discovery) logo, from the official artwork docs/brand/DOD-logo.png (built by
 * docs/brand/dod_logo.py). Every variant is square, `size` × `size`:
 * - `mark`: rounded tile with the glyph enlarged to read at 32 px (header);
 * - `icon`: full-bleed app icon (PWA);
 * - `full`: large rounded tile (login).
 */
const SRC = {
  mark: { src: '/brand/dod-mark.png', ratio: 1 },
  icon: { src: '/brand/dod-icon-192.png', ratio: 1 },
  full: { src: '/brand/dod-logo.webp', ratio: 1 },
} as const

export function Logo({ size = 30, variant = 'mark', alt = '' }: { size?: number; variant?: keyof typeof SRC; alt?: string }) {
  const { src, ratio } = SRC[variant]
  const [w, h] = variant === 'full' ? [size, Math.round(size / ratio)] : [Math.round(size * ratio), size]
  return <img src={src} width={w} height={h} alt={alt} aria-hidden={alt ? undefined : true} style={{ display: 'block', flex: '0 0 auto' }} decoding="async" />
}
