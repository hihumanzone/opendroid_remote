export class PointerIdAllocator {
  readonly #allocated = new Map<string, bigint>();
  readonly #free: bigint[] = [];

  constructor(
    readonly first = 1n,
    readonly last = 31n,
  ) {
    if (first < 0n || last < first) {
      throw new RangeError("Invalid pointer ID range");
    }
    for (let id = last; id >= first; id -= 1n) {
      this.#free.push(id);
    }
  }

  allocate(owner: string): bigint {
    const existing = this.#allocated.get(owner);
    if (existing !== undefined) return existing;
    const id = this.#free.pop();
    if (id === undefined) {
      throw new Error("No synthetic pointer IDs are available");
    }
    this.#allocated.set(owner, id);
    return id;
  }

  get(owner: string): bigint | undefined {
    return this.#allocated.get(owner);
  }

  release(owner: string): bigint | undefined {
    const id = this.#allocated.get(owner);
    if (id === undefined) return undefined;
    this.#allocated.delete(owner);
    this.#free.push(id);
    this.#free.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
    return id;
  }

  releaseAll(): ReadonlyArray<{ owner: string; id: bigint }> {
    const result = [...this.#allocated].map(([owner, id]) => ({ owner, id }));
    this.#allocated.clear();
    this.#free.length = 0;
    for (let id = this.last; id >= this.first; id -= 1n) {
      this.#free.push(id);
    }
    return result;
  }

  get size(): number {
    return this.#allocated.size;
  }
}

