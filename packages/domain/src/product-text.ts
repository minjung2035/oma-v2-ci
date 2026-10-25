/** MAC-231 / MAC-001: the words a guest may use toward the host, and the
 * only strings the host shows of what a guest said. Both ends use this one
 * test. It reads the platform's errno table, so it lives here rather than in
 * the pure protocol codec. */
import { constants } from "node:os";

/** The kernel's own errno names, from the platform's table, so that "ERROR"
 * or "EMAIL" in a sentence is not mistaken for one. */
const ERRNO_NAMES: ReadonlySet<string> = new Set(Object.keys(constants.errno));
/** A top-level directory of a Linux file system, as the start of a path. */
const LINUX_PATH = /(?:^|[\s"'`(=:])\/(?:var|run|etc|home|proc|sys|tmp|usr|opt|dev|lib|lib64|boot|srv|mnt|root|bin|sbin)(?:\/|\b)/;
/** Words that name the machinery rather than the product (MAC-001). */
const LINUX_WORDS = /\b(?:linux|debian|systemd|systemctl|journalctl|journald|cgroups?|kernel|vsock|ext4|erofs|bwrap|bubblewrap|pidfd|openat2|seccomp)\b/i;
const UNIT_NAME = /\b[a-z0-9@_.-]+\.(?:service|socket|timer|path|slice|scope|mount)\b/;

/** MAC-231: what the guest may say about itself. A reason that would carry a
 * Linux path, a unit name, an errno name or the machinery's own words is
 * replaced by the product's word before it leaves the guest; the host shows
 * only strings that pass this. */
export function productText(text: string): boolean {
  if (text.length > 1024 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) return false;
  if (LINUX_PATH.test(text) || LINUX_WORDS.test(text) || UNIT_NAME.test(text)) return false;
  for (const word of text.match(/\bE[A-Z0-9]{2,}\b/g) ?? []) if (ERRNO_NAMES.has(word)) return false;
  return true;
}
