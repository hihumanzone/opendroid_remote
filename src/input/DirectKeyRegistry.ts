export interface DirectAndroidKey {
  domCode: string;
  androidCode: number;
  metaState: number;
}

/**
 * Tracks keys injected directly into Android so focus loss, mode changes,
 * stream replacement, and disconnect can always emit matching key-up events.
 */
export class DirectKeyRegistry {
  readonly #pressed = new Map<string, DirectAndroidKey>();

  get size(): number {
    return this.#pressed.size;
  }

  press(key: DirectAndroidKey): DirectAndroidKey {
    const existing = this.#pressed.get(key.domCode);
    if (existing) return existing;
    const stored = { ...key };
    this.#pressed.set(stored.domCode, stored);
    return stored;
  }

  release(domCode: string): DirectAndroidKey | undefined {
    const key = this.#pressed.get(domCode);
    if (!key) return undefined;
    this.#pressed.delete(domCode);
    return key;
  }

  releaseAll(): DirectAndroidKey[] {
    const keys = [...this.#pressed.values()];
    this.#pressed.clear();
    return keys;
  }

  clear(): void {
    this.#pressed.clear();
  }
}
