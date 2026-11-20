/**
 * The ARIA role of a notice. Urgent ones (warnings, errors) interrupt as
 * `alert`, the rest wait as `status`. `announce={false}` is for a notice that
 * is already on the page when it loads: live roles speak when they appear, so
 * a static banner would be read out on every visit. It becomes a `note`.
 */
export function liveRole(urgent: boolean, announce: boolean): 'alert' | 'status' | 'note' {
  if (!announce) {
    return 'note';
  }
  return urgent ? 'alert' : 'status';
}
