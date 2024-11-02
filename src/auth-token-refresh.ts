import { EcobeeAPIPlatform } from './platform';
import moment from 'moment';
import axios from 'axios';
import querystring from 'querystring';
import { updateHomebridgeConfig } from './config';

export class AuthTokenManager {
	private static instance: AuthTokenManager;
	private readonly ECOBEE_API_KEY = 'LvHbdQIXI5zoGoZW2uyWk2Ejfb1vtQWq';
	private readonly TOKEN_REFRESH_BUFFER = 300; // Refresh 5 minutes before expiration
	private readonly MAX_RETRY_ATTEMPTS = 3;
	private readonly RETRY_DELAY = 2000;

	public authToken = '';
	private refreshToken = '';
	private expiration = moment();
	private refreshInProgress = false;
	private lastRefreshAttempt = moment(0);

	constructor(private readonly platform: EcobeeAPIPlatform) {
		this.refreshToken = platform.config.refreshToken;
	}

	static configureForPlatform(homebridge: EcobeeAPIPlatform) {
		if (!AuthTokenManager.instance) {
			AuthTokenManager.instance = new AuthTokenManager(homebridge);
		}
	}

	static getInstance(): AuthTokenManager {
		return AuthTokenManager.instance;
	}

	isExpired(): boolean {
		return this.authToken === '' || 
			moment().add(this.TOKEN_REFRESH_BUFFER, 'seconds').isAfter(this.expiration);
	}

	private async retryWithDelay<T>(
		operation: () => Promise<T>, 
		retryCount = 0,
	): Promise<T> {
		try {
			return await operation();
		} catch (error) {
			if (retryCount >= this.MAX_RETRY_ATTEMPTS) {
				throw error;
			}

			if (axios.isAxiosError(error) && error.response?.status === 500) {
				this.platform.log.info(
					`Retry attempt ${retryCount + 1}/${this.MAX_RETRY_ATTEMPTS}...`,
				);
				await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
				return this.retryWithDelay(operation, retryCount + 1);
			}

			throw error;
		}
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

		try {
			if (!this.refreshToken) {
				throw new Error('No refresh token in config file');
			}

			const oldRefreshToken = this.refreshToken;
			this.platform.log.info('Renewing auth token');
			this.platform.log.debug('Old refresh token:', oldRefreshToken);

			const authData = await this.retryWithDelay(async () => {
				const response = await axios.post(
					'https://api.ecobee.com/token',
					querystring.stringify({
						grant_type: 'refresh_token',
						code: oldRefreshToken,
						client_id: this.ECOBEE_API_KEY,
					}),
				);
				return response.data;
			});

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
			setTimeout(() => {
				this.renewAuthToken().catch(error => {
					this.platform.log.error('Scheduled token refresh failed:', error);
				});
			}, nextRefreshIn);

			// Update config file with new refresh token
			if (oldRefreshToken !== loadedUpdatedRefreshToken) {
				const updated = updateHomebridgeConfig(this.platform.api, (currentConfig) => {
					return currentConfig.replace(oldRefreshToken, loadedUpdatedRefreshToken);
				});

				if (updated) {
					this.platform.log.debug(
						'Updated refresh token in config:',
						loadedUpdatedRefreshToken,
					);
				}
			}

			return loadedAuthToken;
		} catch (error) {
			let errorMessage: string;
			if (axios.isAxiosError(error)) {
				errorMessage = JSON.stringify(error.response?.data);
			} else {
				errorMessage = error instanceof Error ? error.message : String(error);
			}
			this.platform.log.error(`Error refreshing token: ${errorMessage}`);
			throw error;
		} finally {
			this.refreshInProgress = false;
		}
	}
}