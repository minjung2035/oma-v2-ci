export interface OpenTuiBrand {
  readonly title: string;
  readonly version: string;
  /** The upstream engine's version, as its header prints it. */
  readonly engineVersion: string;
  /** The project path as shown to the Human (home abbreviated to `~`). */
  readonly project: string;
  /** One tip line naming oma's own key. */
  readonly tip: string;
  /** The society this window uses, shown where upstream welcomes the Human. */
  readonly society: string;
  readonly mode?: "Society" | "Personal";
}
