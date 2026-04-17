export class CircuitBreakerOpenError extends Error {
  public readonly openUntilMs: number;

  public constructor(openUntilMs: number) {
    super("LLM circuit breaker is open");
    this.name = "CircuitBreakerOpenError";
    this.openUntilMs = openUntilMs;
  }
}

export class SimpleCircuitBreaker {
  private consecutiveFailures = 0;
  private openUntilMs = 0;

  public constructor(
    private readonly maxConsecutiveFailures: number,
    private readonly openForMs: number
  ) {}

  public canRequest(nowMs: number): void {
    if (nowMs < this.openUntilMs) {
      throw new CircuitBreakerOpenError(this.openUntilMs);
    }
  }

  public onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntilMs = 0;
  }

  public onFailure(nowMs: number): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.openUntilMs = nowMs + this.openForMs;
    }
  }
}

