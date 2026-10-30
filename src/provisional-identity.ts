// Provisional (pre-login) user id bookkeeping shared by both entry points.
//
// The persisted flag is BOUND to the user id it was written for: its value is
// `provisional:<hash of the user id>`, never a bare boolean. An older JS bundle (OTA
// rollback) that identifies a real user rewrites @datalyr/user_id without touching this
// key, and an app killed between the two writes can leave one of them behind; in both
// cases the hash no longer matches the stored user id, so the user counts as signed in.

/** Wire marker on events sent while the current user id is provisional. */
export const PROVISIONAL_MARKER = '$provisional_user_id';

/** FNV-1a over the exact id (case-sensitive): equality check only, no raw id at rest. */
function hashUserId(userId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Value stored under STORAGE_KEYS.USER_ID_PROVISIONAL for a provisional `userId`. */
export function provisionalFlagFor(userId: string): string {
  return `provisional:${hashUserId(userId)}`;
}

/** Whether a stored flag marks `userId` (the stored/restored user id) as provisional. */
export function isProvisionalFlagFor(flag: unknown, userId: string | null | undefined): boolean {
  return typeof flag === 'string' && !!userId && flag === provisionalFlagFor(userId);
}
