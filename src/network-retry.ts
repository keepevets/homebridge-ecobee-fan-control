import axios, { AxiosError } from 'axios';

interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  totalWindowSeconds?: number;
  retryableErrors?: string[];
}

interface Logger {
  error: (message: string, error?: Error | AxiosError) => void;
  debug?: (message: string, ...metadata: unknown[]) => void;
}

export class NetworkRetry {
  private readonly maxAttempts: number;
  private readonly initialDelay: number;
  private readonly maxDelay: number;
  private readonly backoffFactor: number;
  private readonly totalWindowMs: number;
  private readonly retryableErrors: string[];

  constructor(options: RetryOptions = {}) {
    this.totalWindowMs = (options.totalWindowSeconds || 270) * 1000; // Default 4.5 minutes to allow for overhead
    this.maxAttempts = options.maxAttempts || 8;
    this.initialDelay = options.initialDelay || 15000; // 15 seconds
    this.maxDelay = options.maxDelay || 60000; // 1 minute
    this.backoffFactor = options.backoffFactor || 2;
    this.retryableErrors = options.retryableErrors || [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
    ];

    // Validate that our retry strategy fits within the time window
    const theoreticalTotalTime = this.calculateTheoreticalTotalTime();
    if (theoreticalTotalTime > this.totalWindowMs) {
      throw new Error(
        `Retry strategy would take ${theoreticalTotalTime/1000}s which exceeds ` +
        `available window of ${this.totalWindowMs/1000}s`
      );
    }
  }

  private calculateTheoreticalTotalTime(): number {
    let total = 0;
    for (let attempt = 0; attempt < this.maxAttempts - 1; attempt++) {
      total += this.calculateDelay(attempt);
    }
    return total;
  }

  private calculateDelay(attempt: number): number {
    const theoreticalDelay = this.initialDelay * Math.pow(this.backoffFactor, attempt);
    const cappedDelay = Math.min(theoreticalDelay, this.maxDelay);
    
    // Calculate remaining time in our window
    const timeSpentSoFar = this.calculateTheoreticalTimeSpent(attempt);
    const timeRemaining = this.totalWindowMs - timeSpentSoFar;
    
    // Never return a delay longer than remaining time
    return Math.min(cappedDelay, timeRemaining);
  }

  private calculateTheoreticalTimeSpent(upToAttempt: number): number {
    let total = 0;
    for (let attempt = 0; attempt < upToAttempt; attempt++) {
      total += Math.min(
        this.initialDelay * Math.pow(this.backoffFactor, attempt),
        this.maxDelay
      );
    }
    return total;
  }

  private isRetryableError(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      // Check if it's a network error
      if (axiosError.code && this.retryableErrors.includes(axiosError.code)) {
        return true;
      }
      // Check if it's a 5xx server error
      if (axiosError.response?.status && axiosError.response.status >= 500) {
        return true;
      }
    }
    return false;
  }

  async execute<T>(
    operation: () => Promise<T>,
    logger?: Logger,
  ): Promise<T> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const timeElapsed = Date.now() - startTime;
        const timeRemaining = this.totalWindowMs - timeElapsed;

        if (!this.isRetryableError(error) || 
            timeRemaining <= 0 || 
            attempt === this.maxAttempts - 1) {
          throw error;
        }

        const delay = this.calculateDelay(attempt);
        if (logger) {
          logger.error(
            `Network error occurred (attempt ${attempt + 1}/${this.maxAttempts}). ` +
            `Retrying in ${delay/1000}s. Time elapsed: ${timeElapsed/1000}s, ` +
            `Time remaining in window: ${timeRemaining/1000}s`,
            lastError
          );
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}