import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import axios from 'axios';
import { EcobeeAPIPlatform } from './platform';
import { AuthTokenManager } from './auth-token-refresh';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class AwaySwitchAccessory {
	private service: Service;

	// Define constants for climate states
	private readonly CLIMATE_HOME = 'home';
	private readonly CLIMATE_AWAY = 'away';
	private readonly CLIMATE_SLEEP = 'sleep';

	constructor(
		private readonly platform: EcobeeAPIPlatform,
		private readonly accessory: PlatformAccessory,
	) {
		// set accessory information
		this.accessory.getService(this.platform.Service.AccessoryInformation)!
			.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Ecobee')
			.setCharacteristic(this.platform.Characteristic.Model, 'Climate Controller')
			.setCharacteristic(this.platform.Characteristic.SerialNumber, 'ECOBEEAWAY1');

		// Use SecuritySystem service instead of Switch
		this.service = this.accessory.getService(this.platform.Service.SecuritySystem) 
			|| this.accessory.addService(this.platform.Service.SecuritySystem);

		// Set the service name
		this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

		// Register handlers for the SecuritySystemTargetState Characteristic
		this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
			.setProps({
				validValues: [
					this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM,  // Home
					this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM,  // Away
					this.platform.Characteristic.SecuritySystemTargetState.NIGHT_ARM, // Sleep
				],
			})
			.on('set', this.setTargetState.bind(this))
			.on('get', this.getTargetState.bind(this));

		// Register handlers for the SecuritySystemCurrentState Characteristic
		this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
			.on('get', this.getCurrentState.bind(this));

		// Poll for updates
		setInterval(async () => {
			const apiStatus = await this.checkStatusFromAPI();
			const currentState = this.mapClimateToSecurityState(apiStatus);
			this.service.updateCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState, currentState);
			this.service.updateCharacteristic(this.platform.Characteristic.SecuritySystemTargetState, currentState);
			this.platform.log.debug('Pushed updated current state to HomeKit:', apiStatus);
		}, 30 * 60 * 1000);
	}

	/**
	 * Maps climate mode to HomeKit security system state
	 */
	private mapClimateToSecurityState(climate: string): number {
		switch (climate) {
		case this.CLIMATE_AWAY:
			return this.platform.Characteristic.SecuritySystemCurrentState.AWAY_ARM;
		case this.CLIMATE_SLEEP:
			return this.platform.Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
		case this.CLIMATE_HOME:
		default:
			return this.platform.Characteristic.SecuritySystemCurrentState.STAY_ARM;
		}
	}

	/**
	 * Maps HomeKit security system state to climate mode
	 */
	private mapSecurityToClimate(state: number): string {
		switch (state) {
		case this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM:
			return this.CLIMATE_AWAY;
		case this.platform.Characteristic.SecuritySystemTargetState.NIGHT_ARM:
			return this.CLIMATE_SLEEP;
		case this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM:
		default:
			return this.CLIMATE_HOME;
		}
	}

	/**
	 * Handle SET requests from HomeKit
	 */
	async setTargetState(value: CharacteristicValue, callback: CharacteristicSetCallback) {
		try {
			const targetState = value as number;
			const climateRef = this.mapSecurityToClimate(targetState);
			
			const needsRefresh = AuthTokenManager.getInstance().isExpired();
			if (needsRefresh) {
				await AuthTokenManager.getInstance().renewAuthToken();
			}
			const authToken = AuthTokenManager.getInstance().authToken;
			const selectionMatch = this.platform.config.thermostatSerialNumbers || '';
			const selectionType = selectionMatch ? 'thermostats' : 'registered';

			if (climateRef === this.CLIMATE_HOME) {
				// Resume program for home mode
				const homeBody = {
					'selection': {
						'selectionType': selectionType,
						'selectionMatch': selectionMatch,
					},
					'functions': [
						{
							'type': 'resumeProgram',
							'params': {
								'resumeAll': false,
							},
						},
					],
				};
				const homeSetRequest = await axios.post('https://api.ecobee.com/1/thermostat?format=json', 
					homeBody, 
					{headers: {'Authorization': 'Bearer ' + authToken}},
				);
				this.platform.log.info(`Set Ecobee to home with result: ${JSON.stringify(homeSetRequest.data)}`);
			} else {
				// Set hold for away or sleep mode
				const setHoldBody = {
					'selection': {
						'selectionType': selectionType,
						'selectionMatch': selectionMatch,
					},
					'functions': [
						{
							'type': 'setHold',
							'params': {
								'holdType': 'indefinite',
								'holdClimateRef': climateRef,
							},
						},
					],
				};
				const setHoldRequest = await axios.post('https://api.ecobee.com/1/thermostat?format=json', 
					setHoldBody, 
					{headers: {'Authorization': 'Bearer ' + authToken}},
				);
				this.platform.log.info(`Set Ecobee to ${climateRef} with result: ${JSON.stringify(setHoldRequest.data)}`);
			}

			this.platform.log.debug('Set Target State ->', value);
			callback(null);
		} catch (error) {
			callback(error as Error);
		}
	}

	/**
	 * Handle GET requests for target state
	 */
	async getTargetState(callback: CharacteristicGetCallback) {
		const apiStatus = await this.checkStatusFromAPI();
		const state = this.mapClimateToSecurityState(apiStatus);
		this.platform.log.debug('Get Target State ->', state);
		callback(null, state);
	}

	/**
	 * Handle GET requests for current state
	 */
	async getCurrentState(callback: CharacteristicGetCallback) {
		const apiStatus = await this.checkStatusFromAPI();
		const state = this.mapClimateToSecurityState(apiStatus);
		this.platform.log.debug('Get Current State ->', state);
		callback(null, state);
	}

	/**
	 * Check the current climate status from the Ecobee API
	 */
	private async checkStatusFromAPI(): Promise<string> {
		const needsRefresh = AuthTokenManager.getInstance().isExpired();
		if (needsRefresh) {
			await AuthTokenManager.getInstance().renewAuthToken();
		}
		const authToken = AuthTokenManager.getInstance().authToken;

		const queryRequest = await axios.get(
			'https://api.ecobee.com/1/thermostat?format=json&body={"selection":{"selectionType":"registered","selectionMatch":"","includeEvents":true}}',
			{headers: {'Authorization': 'Bearer ' + authToken}},
		);
		const queryData = queryRequest.data;

		if (!queryData || !queryData.thermostatList) {
			this.platform.log.error('Unexpected query data: ' + JSON.stringify(queryData));
			return this.CLIMATE_HOME;
		}
			
		const events = queryData.thermostatList[0].events;

		if (events.length > 0) {
			const mostRecentEvent = events[0];
			return mostRecentEvent.holdClimateRef || this.CLIMATE_HOME;
		} else {
			return this.CLIMATE_HOME;
		}
	}
}