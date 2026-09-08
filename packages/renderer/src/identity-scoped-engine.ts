export interface DestroyableEngine {
  destroy(): void | Promise<void>;
}

function staleEngineError(): Error {
  const error = new Error("The requested audio engine is no longer current.");
  error.name = "AbortError";
  return error;
}

export class IdentityScopedEngineSlot<Engine extends DestroyableEngine> {
  private identity: string;
  private epoch = 0;
  private engine?: Engine;
  private promise?: Promise<Engine>;
  private controller?: AbortController;
  private disposed = false;

  constructor(identity: string) {
    this.identity = identity;
  }

  current(identity: string): Engine | undefined {
    return this.identity === identity ? this.engine : undefined;
  }

  pending(identity: string): Promise<Engine> | undefined {
    return !this.disposed && this.identity === identity
      ? this.promise
      : undefined;
  }

  owns(identity: string): boolean {
    return !this.disposed && this.identity === identity;
  }

  isCurrent(identity: string, engine: Engine): boolean {
    return (
      !this.disposed && this.identity === identity && this.engine === engine
    );
  }

  replace(identity: string): Promise<void> {
    if (!this.disposed && this.identity === identity) return Promise.resolve();
    const stale = this.detach();
    this.identity = identity;
    this.disposed = false;
    return stale
      ? Promise.resolve(stale.destroy()).then(() => undefined)
      : Promise.resolve();
  }

  async get(
    identity: string,
    create: (signal: AbortSignal) => Promise<Engine>,
  ): Promise<Engine> {
    if (this.disposed) throw staleEngineError();
    if (this.identity !== identity) await this.replace(identity);
    if (this.engine) return this.engine;
    if (this.promise) return this.promise;

    const epoch = this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    const creation = create(controller.signal);
    this.promise = creation;
    try {
      const created = await creation;
      if (
        this.disposed ||
        controller.signal.aborted ||
        this.identity !== identity ||
        this.epoch !== epoch
      ) {
        await created.destroy();
        throw staleEngineError();
      }
      this.engine = created;
      return created;
    } finally {
      if (this.promise === creation) this.promise = undefined;
      if (this.controller === controller) this.controller = undefined;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const stale = this.detach();
    if (stale) await stale.destroy();
  }

  private detach(): Engine | undefined {
    this.epoch += 1;
    this.controller?.abort(staleEngineError());
    this.controller = undefined;
    this.promise = undefined;
    const stale = this.engine;
    this.engine = undefined;
    return stale;
  }
}
