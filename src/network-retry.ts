// network-retry.ts
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

      // Check if it's a 429 rate limit error
      if (axiosError.response?.status === 429) {
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

  private calculateDelay(attempt: number, error?: unknown): number {
    // Check for rate limit headers first
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      // Check for Retry-After header
      const retryAfter = error.response.headers['retry-after'];
      if (retryAfter) {
        // If it's a number, it's seconds; if it's a date, parse it
        const retryAfterMs = isNaN(Number(retryAfter))
          ? new Date(retryAfter).getTime() - Date.now()
          : Number(retryAfter) * 1000;

        // Ensure it's within reasonable bounds
        return Math.min(Math.max(retryAfterMs, this.initialDelay), 5 * 60 * 1000); // Max 5 minutes
      }

      // For 429 without Retry-After, use longer delays
      const baseDelay = this.initialDelay * Math.pow(2, attempt + 2); // More aggressive backoff
      const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
      return Math.min(baseDelay + jitter, this.maxDelay * 2); // Allow longer delays for rate limits
    }

    // Original calculation for other errors
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

        const delay = this.calculateDelay(attempt, error);

        if (logger) {
          const errorMessage = this.formatErrorMessage(error);

          // Special handling for rate limit errors
          if (axios.isAxiosError(error) && error.response?.status === 429) {
            logger.warn(
              `${context} rate limited. Waiting ${Math.round(delay / 1000)}s before retry...`
            );
          } else if (this.shouldReduceVerbosity()) {
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