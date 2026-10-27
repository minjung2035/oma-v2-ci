/** Package format and names shared by Runtime and platform adapters. */


/** Where staged local-package copies live in the store, beside `npm/` and
 * `git/` (C20; local-package.ts does the staging). */
export const PACKAGE_LOCAL_DIR = "local";

export const PACKAGE_ARCHIVE_BOUNDS = Object.freeze({
  /** Files and directories one archive may hold: the working-set bound of the
   * in-memory index of made paths (`made`), not a size policy. An archive
   * beyond it would carry a package no real store holds. */
  entries: 8_000_000,
  /** Bytes of file content one archive may hold. Payloads stream a chunk at a
   * time both ways, so this is not a memory bound: it is the largest size a
   * wire u64 still names exactly -- beyond it a size could not be observed
   * exactly at all, which is a stream-honest refusal, not a capacity one. */
  bytes: Number.MAX_SAFE_INTEGER,
  /** Bytes one file may have: the same exact-observation bound. */
  fileBytes: Number.MAX_SAFE_INTEGER,
  /** Bytes of one entry's path: a staged path must also land on a filesystem
   * (PATH_MAX class), and the wire length field is u16 -- format-mandated. */
  pathBytes: 4096,
  /** Bytes of one path component: NAME_MAX -- format-mandated. */
  componentBytes: 255,
});


export const PACKAGE_USAGE = "usage: oma pi install <npm:… | git:… | https://… | ssh://… | local dir, tarball or file>\n" +
  "       oma pi remove <source>\n" +
  "       oma pi update <source> | --extension <source> | --extensions\n" +
  "       oma pi list\n" +
  "Packages carry extensions, skills, prompt templates and themes; a local path is copied into the store.";
