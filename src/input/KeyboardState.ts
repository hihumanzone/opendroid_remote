export class KeyboardState {
  readonly #pressed = new Set<string>();

  press(code: string): boolean {
    const first = !this.#pressed.has(code);
    this.#pressed.add(code);
    return first;
  }

  release(code: string): boolean {
    return this.#pressed.delete(code);
  }

  has(code: string): boolean {
    return this.#pressed.has(code);
  }

  clear(): string[] {
    const pressed = [...this.#pressed];
    this.#pressed.clear();
    return pressed;
  }

  snapshot(): ReadonlySet<string> {
    return new Set(this.#pressed);
  }

  get size(): number {
    return this.#pressed.size;
  }
}

