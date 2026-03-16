export interface GuardRunResult<T> {
  executed: boolean;
  value?: T;
}

export class DocumentRunGuard {
  private readonly activeKeys = new Set<string>();

  public isRunning(documentKey: string): boolean {
    return this.activeKeys.has(documentKey);
  }

  public async run<T>(documentKey: string, operation: () => Promise<T>): Promise<GuardRunResult<T>> {
    if (this.activeKeys.has(documentKey)) {
      return { executed: false };
    }

    this.activeKeys.add(documentKey);

    try {
      return {
        executed: true,
        value: await operation(),
      };
    } finally {
      this.activeKeys.delete(documentKey);
    }
  }
}
