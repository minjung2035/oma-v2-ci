export interface KeychainStore {
  /** The item's value, or undefined when there is none. A locked or
   * unreadable Keychain throws (MAC-702): that is not "no credential". */
  get(account: string): Promise<string | undefined>;
  put(account: string, value: string): Promise<void>;
  /** The writer helper inherits the lock and ends before it is returned. */
  withWriter?<T>(fence: number, run: (writer: KeychainStore) => Promise<T>): Promise<T>;
}

