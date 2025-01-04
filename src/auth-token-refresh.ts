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

  constructor(private readonly platform: EcobeeAPIPlatform) {
    this.refreshToken = platform.config.refreshToken;
    this.networkRetry = new NetworkRetry({
      totalWindowSeconds: this.TOKEN_REFRESH_BUFFER - 30, // Leave 30s buffer for overhead
      maxAttempts: 8,        // Try up to 8 times over the window
      initialDelay: 15000,   // Start with 15 seconds
      maxDelay: 60000,       // Cap at 1 minute between retries
      backoffFactor: 2,      // Double the delay each attempt
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
    if (timeSinceLastAttempt < 30) {
      this.platform.log.debug(
        `Skipping refresh, last attempt was ${timeSinceLastAttempt}s ago`,
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

      return loadedAuthToken;
    } catch (error) {
      // Only log detailed error if it's not a known network error
      if (!this.networkRetry.isRetryableNetworkError(error)) {
      this.platform.log.warn('Error refreshing token:', error);
      }

      // Schedule a retry in the background
      this.scheduleBackgroundRefresh(30000); // 30 seconds
      return undefined;
    } finally {
      this.refreshInProgress = false;
    }
  }
}