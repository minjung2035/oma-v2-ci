/** P0V-108 (seventh review F-06, G11 §4), TUI-002: the characters a screen
 * does not show as what they are -- the one definition the product's
 * display and its paste reading both use.
 *
 * - C0 and C1 controls and DEL (Unicode `Cc`): a terminal reads them as
 *   instructions -- move the cursor, change colour, start a paste.
 * - Format characters (Unicode `Cf`): bidi embeddings, overrides and
 *   isolates reorder the letters around them on screen (a file name, an
 *   address or a command read backwards); zero-width spaces, the word joiner,
 *   the BOM, the soft hyphen and the tag characters hide text between
 *   visible letters. The two joiners (ZWNJ U+200C, ZWJ U+200D) are kept:
 *   they only choose how neighbouring letters are drawn -- an emoji
 *   sequence, a Persian word -- and move or hide nothing.
 */

/** Every character a screen draws differently from what it is, tab and line
 * feed included (their callers handle them first). */
export const UNSEEN = /\p{Cc}|(?![‌‍])\p{Cf}/gu;

/** The same, keeping tab and line feed: text the Human may send. */
export const UNSEEN_EXCEPT_LAYOUT = /(?![\t\n])\p{Cc}|(?![‌‍])\p{Cf}/gu;
