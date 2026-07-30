export class QueueClosedError extends Error {
  constructor() {
    super("The operation queue is closed");
    this.name = "QueueClosedError";
  }
}

/**
 * Runs lifecycle mutations in request order while ensuring a rejected task
 * never poisons later work. Callers still receive the original task result.
 */
export class SerialTaskQueue {
  #tail: Promise<void> = Promise.resolve();
  #closed = false;

  get closed(): boolean {
    return this.#closed;
  }

  run<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.#closed) return Promise.reject(new QueueClosedError());
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async drain(): Promise<void> {
    await this.#tail;
  }

  close(): void {
    this.#closed = true;
  }
}
