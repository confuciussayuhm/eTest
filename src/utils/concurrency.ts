/**
 * Concurrency Control Utilities
 */

type UnlockFunction = () => void;

export class SessionMutex {
  private locks: Map<string, Promise<void>> = new Map();

  async lock(sessionId: string): Promise<UnlockFunction> {
    if (this.locks.has(sessionId)) {
      await this.locks.get(sessionId);
    }

    let resolve: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    this.locks.set(sessionId, promise);

    return () => {
      this.locks.delete(sessionId);
      resolve!();
    };
  }
}
