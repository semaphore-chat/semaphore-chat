/**
 * Which of the new shell's banners have been read out already, by a key per notice, so a banner that
 * mounts again after a shell flip shows quietly instead of being announced again (review Minor 3), and
 * the connection state last announced. Eager and tiny, so the session teardown can clear it without
 * importing the new shell's chunk.
 */
const announced = new Set<string>();

/** True the first time a key is asked for (announce it), false after (already heard). */
export function takeFirstAnnouncement(key: string): boolean {
  if (announced.has(key)) return false;
  announced.add(key);
  return true;
}

/** Forget every key not in `present`: a notice that went and comes back is new again. */
export function forgetAnnouncementsExcept(present: ReadonlySet<string>): void {
  for (const key of [...announced]) {
    if (!present.has(key)) announced.delete(key);
  }
}

export function forgetAllAnnouncements(): void {
  announced.clear();
}
