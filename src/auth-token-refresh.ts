// auth-token-refresh.ts
import { EcobeeAPIPlatform } from './platform';
import moment from 'moment';
import axios from 'axios';
import querystring from 'querystring';
import { updateHomebridgeConfig } from './config';
import { NetworkRetry } from './network-retry';

export class AuthTokenManager {
  private static instance: AuthTokenManager;
  private readonly ECOBEE_API_KEY = 'LvHbdQIXI5zoGoZW2uyWk2Ejfb1vtQWq';
  private readonly TOKEN_REFRESH_BUFFER = 300; // Refresh 5 minutes before expiration
  private readonly networkRetry: NetworkRetry;

  public authToken = '';
  private refreshToken = '';
  private expiration = moment();
  private refreshInProgress = false;
  private lastRefreshAttempt = moment(0);
  private backgroundRefreshTimeout?: ReturnType<typeof setTimeout>;
  private readonly MIN_REFRESH_INTERVAL = 60; // Increase from 30 to 60 seconds
  private readonly RATE_LIMIT_BACKOFF = 5 * 60 * 1000; // 5 minutes for rate limit errors
  private rateLimitedUntil?: moment.Moment;

  constructor(private readonly platform: EcobeeAPIPlatform) {
    this.refreshToken = platform.config.refreshToken;
    this.networkRetry = new NetworkRetry({
      totalWindowSeconds: this.TOKEN_REFRESH_BUFFER - 30,
      maxAttempts: 5,          // Reduce attempts for rate limiting
      initialDelay: 30000,     // Start with 30 seconds for auth endpoints
      maxDelay: 120000,        // Cap at 2 minutes between retries
      backoffFactor: 2,
    });
  }

  static configureForPlatform(platform: EcobeeAPIPlatform) {
    if (!AuthTokenManager.instance) {
      AuthTokenManager.instance = new AuthTokenManager(platform);
    }
  }

  static getInstance(): AuthTokenManager {
    return AuthTokenManager.instance;
  }

  isExpired(): boolean {
    // Check if we're rate limited
    if (this.rateLimitedUntil && moment().isBefore(this.rateLimitedUntil)) {
      return false; // Don't attempt refresh while rate limited
    }

    return this.authToken === '' ||
      moment().add(this.TOKEN_REFRESH_BUFFER, 'seconds').isAfter(this.expiration);
  }

  private clearBackgroundRefresh() {
    if (this.backgroundRefreshTimeout) {
      clearTimeout(this.backgroundRefreshTimeout);
      this.backgroundRefreshTimeout = undefined;
    }
  }

  private scheduleBackgroundRefresh(delayMs: number) {
    this.clearBackgroundRefresh();

    this.backgroundRefreshTimeout = setTimeout(() => {
      this.renewAuthToken()
        .catch(error => {
          // Only log if it's not a known network error
          if (!this.networkRetry.isRetryableNetworkError(error)) {
            this.platform.log.error('Background token refresh failed:', error);
          }
        });
    }, delayMs);
  }

  async renewAuthToken(): Promise<string | undefined> {
    // Check if we're in a rate limit backoff period
    if (this.rateLimitedUntil && moment().isBefore(this.rateLimitedUntil)) {
      const waitTime = this.rateLimitedUntil.diff(moment(), 'seconds');
      this.platform.log.warn(
        `Rate limited. Waiting ${waitTime}s before attempting token refresh.`
      );
      return this.authToken; // Return existing token if still valid
    }

    // Prevent multiple simultaneous refresh attempts
    if (this.refreshInProgress) {
      this.platform.log.debug('Token refresh already in progress, waiting...');
      while (this.refreshInProgress) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.authToken;
    }

    // Prevent too frequent refresh attempts
    const timeSinceLastAttempt = moment().diff(this.lastRefreshAttempt, 'seconds');
    if (timeSinceLastAttempt < this.MIN_REFRESH_INTERVAL) {
      this.platform.log.debug(
        `Skipping refresh, last attempt was ${timeSinceLastAttempt}s ago`
      );
      return this.authToken;
    }

    this.refreshInProgress = true;
    this.lastRefreshAttempt = moment();
    this.clearBackgroundRefresh();

    try {
      if (!this.refreshToken) {
        throw new Error('No refresh token in config file');
      }

      const oldRefreshToken = this.refreshToken;

      const authData = await this.networkRetry.execute(
        async () => {
          const response = await axios.post(
            'https://api.ecobee.com/token',
            querystring.stringify({
              grant_type: 'refresh_token',
              code: oldRefreshToken,
              client_id: this.ECOBEE_API_KEY,
            }),
            {
              headers: {
                'User-Agent': 'homebridge-ecobee-status/2.x',
              }
            }
          );
          return response.data;
        },
        this.platform.log,
        'Token refresh'
      );

      const loadedAuthToken = authData.access_token;
      const loadedExpiresIn = authData.expires_in;
      const loadedUpdatedRefreshToken = authData.refresh_token ?? oldRefreshToken;

      // Validate the received tokens
      if (!loadedAuthToken || !loadedExpiresIn) {
        throw new Error('Invalid token data received from Ecobee API');
      }

      this.authToken = loadedAuthToken;
      this.refreshToken = loadedUpdatedRefreshToken;
      this.expiration = moment().add(loadedExpiresIn, 'seconds');

      // Schedule next refresh before token expires
      const nextRefreshIn = (loadedExpiresIn - this.TOKEN_REFRESH_BUFFER) * 1000;
      this.scheduleBackgroundRefresh(nextRefreshIn);

      // Update config file with new refresh token
      if (oldRefreshToken !== loadedUpdatedRefreshToken) {
        const updated = updateHomebridgeConfig(this.platform.api, (currentConfig) => {
          return currentConfig.replace(oldRefreshToken, loadedUpdatedRefreshToken);
        });

        if (updated) {
          this.platform.log.debug(
            'Updated refresh token in config',
          );
        }
      }

      // Clear rate limit on success
      this.rateLimitedUntil = undefined;

      return loadedAuthToken;
    } catch (error) {
      // Handle rate limit errors specifically
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        // Set rate limit backoff
        this.rateLimitedUntil = moment().add(this.RATE_LIMIT_BACKOFF, 'milliseconds');

        this.platform.log.error(
          `Token refresh rate limited. Will retry after ${this.rateLimitedUntil.format('HH:mm:ss')}`
        );

        // Schedule retry after rate limit period
        this.scheduleBackgroundRefresh(this.RATE_LIMIT_BACKOFF);
      } else if (!this.networkRetry.isRetryableNetworkError(error)) {
        this.platform.log.warn('Error refreshing token:', error);
        // Schedule a normal retry
        this.scheduleBackgroundRefresh(60000); // 1 minute
      }
      return undefined;
    } finally {
      this.refreshInProgress = false;
    }
  }
}