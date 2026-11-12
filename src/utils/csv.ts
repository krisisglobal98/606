/**
 * A text cell of a CSV file: quoted, and safe to open in a spreadsheet. Text that starts with = + - @ (or a tab /
 * carriage return) is read as a formula by Excel and others ("CSV injection": a value from the source data or a
 * name typed by a user could run a formula on the reader's computer). Such text gets a leading apostrophe, which
 * spreadsheets show as plain text. Numbers are written by the caller as numbers, never through this function.
 */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return `"${safe.replace(/"/g, '""')}"`
}
