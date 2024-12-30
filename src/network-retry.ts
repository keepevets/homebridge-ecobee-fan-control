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
  warn: (message: string, ...metadata: unknown[]) => void;
  debug?: (message: string, ...metadata: unknown[]) => void;
}

export class NetworkRetry {
  private readonly maxAttempts: number;
  private readonly initialDelay: number;
  private readonly maxDelay: number;
  private readonly backoffFactor: number;
  private readonly totalWindowMs: number;
  private readonly retryableErrors: string[];
  private consecutiveFailures: number = 0;
  private lastSuccessTime: number = Date.now();

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
  }

  // Public method for external error checking
  public isRetryableNetworkError(error: unknown): boolean {
    return this.isRetryableError(error);
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

      // Check if it's a DNS resolution error
      if (axiosError.code === 'EAI_AGAIN') {
        return true;
      }

      // Check if it's a timeout error
      if (axiosError.code === 'ETIMEDOUT') {
        return true;
      }
    }
    return false;
  }

  private formatErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      let message = axiosError.message;

      if (axiosError.code === 'EAI_AGAIN') {
        message = 'DNS resolution failed - network may be temporarily unavailable';
      } else if (axiosError.code === 'ETIMEDOUT') {
        message = 'Connection timed out - network may be temporarily unavailable';
      }

      if (axiosError.response?.data) {
        const data = typeof axiosError.response.data === 'string'
          ? axiosError.response.data
          : JSON.stringify(axiosError.response.data);
        message += ` (${data})`;
      }
      return message;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private calculateDelay(attempt: number): number {
    // Base exponential backoff
    const baseDelay = this.initialDelay * Math.pow(this.backoffFactor, attempt);

    // Add jitter (±25% of base delay)
    const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
    const delay = baseDelay + jitter;

    // Cap at max delay
    return Math.min(delay, this.maxDelay);
  }

  private shouldReduceVerbosity(): boolean {
    const timeSinceSuccess = Date.now() - this.lastSuccessTime;
    return this.consecutiveFailures > 3 || timeSinceSuccess > 5 * 60 * 1000;
  }

  async execute<T>(
    operation: () => Promise<T>,
    logger?: Logger,
    context: string = 'operation'
  ): Promise<T> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const result = await operation();
        this.consecutiveFailures = 0;
        this.lastSuccessTime = Date.now();
        return result;
      } catch (error) {
        this.consecutiveFailures++;
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
          const errorMessage = this.formatErrorMessage(error);

          // Reduce log verbosity if we're seeing repeated failures
          if (this.shouldReduceVerbosity()) {
            if (attempt === 0) {
              logger.warn(
                `${context} failed: ${errorMessage}. Will retry in background.`
              );
            }
          } else {
            logger.warn(
              `${context} failed (attempt ${attempt + 1}/${this.maxAttempts}): ${errorMessage}. ` +
              `Retrying in ${Math.round(delay / 1000)}s...`
            );
          }
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}