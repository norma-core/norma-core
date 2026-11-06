/**
 * Tracks one asynchronous robot load at a time. Each `begin` hands out a
 * token; `settle` accepts only the token of the most recent load, so a load
 * that was cancelled (the URDF changed while it was in flight) is reported as
 * stale and its result can be discarded instead of being added to the scene.
 */
export class LoadTracker {
  private generation = 0;
  private pending = false;

  get isPending(): boolean {
    return this.pending;
  }

  begin(): number {
    this.pending = true;
    this.generation += 1;
    return this.generation;
  }

  cancel(): void {
    this.pending = false;
    this.generation += 1;
  }

  /** Whether `token` belongs to the most recent load (pending or settled). */
  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  settle(token: number): boolean {
    if (token !== this.generation) return false;
    this.pending = false;
    return true;
  }
}
