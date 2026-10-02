/** DR18 (D-1, MAC-022): the one reading of an error's words on the product
 * surface. On Linux the words are the Human's own world -- their paths, their
 * system's names -- and are shown as they are. Shown on a Mac through the
 * guest's terminal session (which sets `OMA_PRODUCT_TEXT=1`), a Linux path,
 * a unit name, an errno name or the machinery's own words would expose the
 * hidden platform (MAC-001): such words are replaced by the product's word
 * and the error's code, and the original goes to the guest's log. There the
 * process's stderr is the session holder's, which is the journal, not the
 * screen; the Human's own messages then go to stdout.
 */
import { errorCodeOf } from "../domain/errors.js";
import { productText } from "../platform/product-text.js";
import { READ_BOUNDS } from "./limits.js";

export const PRODUCT_TEXT_ENV = "OMA_PRODUCT_TEXT";
const logged = new Set<string>();

const productSurface = (): boolean => process.env[PRODUCT_TEXT_ENV] === "1";

/** `text` as the surface may show it; `instead` where it may not. Each
 * replaced text is logged once, so a view redrawn every second does not fill
 * the log with one reason. */
export function surfaceWords(text: string, instead: string): string {
  if (!productSurface() || productText(text)) return text;
  if (!logged.has(text) && logged.size < READ_BOUNDS.loggedWords.value) {
    logged.add(text);
    process.stderr.write(`oma: ${text}\n`);
  }
  return instead;
}

/** The words of anything thrown. */
export function errorWords(error: unknown): string {
  return surfaceWords(error instanceof Error ? error.message : String(error), `Error code ${errorCodeOf(error)}`);
}

/** Where a message for the Human goes when no screen is drawn. */
export function humanStream(): NodeJS.WriteStream {
  return productSurface() ? process.stdout : process.stderr;
}
