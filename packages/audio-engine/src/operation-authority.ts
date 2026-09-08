export interface OperationToken<Kind extends string> {
  readonly kind: Kind;
  readonly epoch: number;
  readonly signal: AbortSignal;
}

function cancellationError(kind?: string): Error {
  const error = new Error(
    kind
      ? `The ${kind} operation was superseded.`
      : "The audio operation was cancelled.",
  );
  error.name = "AbortError";
  return error;
}

export class OperationAuthority<Kind extends string> {
  private epoch = 0;
  private controller?: AbortController;

  begin(kind: Kind): OperationToken<Kind> {
    this.cancel(kind);
    const controller = new AbortController();
    this.controller = controller;
    return { kind, epoch: this.epoch, signal: controller.signal };
  }

  assertCurrent(token: OperationToken<Kind>): void {
    if (
      token.signal.aborted ||
      token.epoch !== this.epoch ||
      token.signal !== this.controller?.signal
    )
      throw token.signal.reason instanceof Error
        ? token.signal.reason
        : cancellationError(token.kind);
  }

  isCurrent(token: OperationToken<Kind>): boolean {
    try {
      this.assertCurrent(token);
      return true;
    } catch {
      return false;
    }
  }

  finish(token: OperationToken<Kind>): void {
    if (this.isCurrent(token)) this.controller = undefined;
  }

  cancel(nextKind?: Kind): void {
    this.epoch += 1;
    const controller = this.controller;
    this.controller = undefined;
    controller?.abort(cancellationError(nextKind));
  }
}
