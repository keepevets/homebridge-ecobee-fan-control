// awaySwitchAccessory.ts
import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import axios from 'axios';
import { EcobeeAPIPlatform } from './platform';
import { AuthTokenManager } from './auth-token-refresh';
import { NetworkRetry } from './network-retry';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class FanSwitchAccessory {
  private service: Service;
  private readonly networkRetry: NetworkRetry;

  // Define constants for climate states
  private readonly FAN_ON = 'on';
  private readonly FAN_AUTO = 'auto';


  constructor(
    private readonly platform: EcobeeAPIPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Initialize NetworkRetry with appropriate settings for API calls
    this.networkRetry = new NetworkRetry({
      maxAttempts: 8,
      initialDelay: 15000, // 15 seconds
      maxDelay: 60000, // 1 minute
      backoffFactor: 2,
      retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'],
    });

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Ecobee')
      .setCharacteristic(this.platform.Characteristic.Model, 'Climate Controller')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'ECOBEEFAN1');

    // Use SecuritySystem service instead of Switch
    this.service =
      this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    // Register handlers for the SecuritySystemTargetState Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .on('set', this.setTargetState.bind(this))
      .on('get', this.getTargetState.bind(this));

    // Poll for updates
    const pollingMinutes = this.platform.config.statusPollingMinutes || 60;
    const pollingInterval = pollingMinutes * 60 * 1000;

    setInterval(async () => {
      try {
        const apiStatus = await this.checkStatusFromAPI();
        const currentState = apiStatus === this.FAN_ON ? true : this.platform.Characteristic.Active.INACTIVE; // explicit false for current state
        // const targetState = apiStatus === this.FAN_ON ? this.platform.Characteristic.Active.ON : this.platform.Characteristic.Active.OFF;    // explicit true for target state
        this.service.updateCharacteristic(this.platform.Characteristic.Active, currentState);
        // this.service.updateCharacteristic(this.platform.Characteristic.Active, targetState);
        this.platform.log.debug('Pushed updated current state to HomeKit:', apiStatus);
      } catch (error) {
        this.platform.log.debug('Failed to poll status:', error);
      }
    }, pollingInterval);
  }

  /**
   * Helper method to handle API requests with retry logic
   */
  private async makeEcobeeRequest<T>(request: () => Promise<T>, operationType: string): Promise<T> {
    return this.networkRetry.execute(
      request,
      this.platform.log,
      `Ecobee API ${operationType}`
    );
  }

  /**
   * Handle SET requests from HomeKit
   */
  async setTargetState(value, callback: CharacteristicSetCallback) {
    try {
      const targetState = value as boolean;
      const fanRef = targetState !== true ? this.FAN_AUTO : this.FAN_ON;

      const needsRefresh = AuthTokenManager.getInstance().isExpired();
      if (needsRefresh) {
        const refreshedToken = await AuthTokenManager.getInstance().renewAuthToken();
        if (!refreshedToken) {
          throw new Error('Failed to refresh expired auth token');
        }
      }
      const authToken = AuthTokenManager.getInstance().authToken;
      const selectionMatch = this.platform.config.thermostatSerialNumbers || '';
      const selectionType = selectionMatch ? 'thermostats' : 'registered';


      // Determine if we should use indefinite hold based on the state
      let requestBody;
      switch (targetState) {
        case true:
			requestBody = {
				'selection': {
				  'selectionType': selectionType,
				  'selectionMatch': selectionMatch,
				},
				'functions': [
					{
						"type":"setHold",
						"params": {
							"coolHoldTemp":859,
							"heatHoldTemp":450,
							"holdType":"indefinite",
							"fan":"on",
							"isTemperatureAbsolute":false,
							"isTemperatureRelative":false
						},
					},
				],
			  };
          break;
        default:
			requestBody = {
				'selection': {
				  'selectionType': selectionType,
				  'selectionMatch': selectionMatch,
				},
				'functions': [
					{
						"type":"setHold",
						"params": {
							"coolHoldTemp":859,
							"heatHoldTemp":450,
							"holdType":"indefinite",
							"fan":"auto",
							"isTemperatureAbsolute":false,
							"isTemperatureRelative":false
						},
					},
				],
			  };
          break;
      }

      const response = await this.makeEcobeeRequest(
        () => axios.post(
          'https://api.ecobee.com/1/thermostat?format=json',
          requestBody,
          { headers: { 'Authorization': 'Bearer ' + authToken } },
        ),
        `${fanRef.toUpperCase()} mode set`,
      );

      this.platform.log.info(`Set Ecobee to ${fanRef} with result: ${JSON.stringify(response.data)}`);

      if (response.data.status.code === 0) {
        // Add a small delay to allow the thermostat to process the change
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Double-check the current status to ensure it took effect
        const currentStatus = await this.checkStatusFromAPI();
        if (currentStatus !== fanRef) {
          this.platform.log.warn(`${fanRef.toUpperCase()} mode set succeeded but status check shows different state:`, currentStatus);
        }

        this.service.updateCharacteristic(this.platform.Characteristic.Active, targetState);
        this.platform.log.debug(`Successfully updated to ${fanRef.toUpperCase()} state`);
      } else {
        throw new Error(`Failed to set ${fanRef.toUpperCase()} mode: ${JSON.stringify(response.data)}`);
      }

      callback(null);
    } catch (error) {
      this.platform.log.error('Failed to set target state:', error);
      callback(error as Error);
    }
  }

  /**
   * Handle GET requests for target state
   */
  async getTargetState(callback: CharacteristicGetCallback) {
    try {
      const apiStatus = await this.checkStatusFromAPI();
      const state = apiStatus === this.FAN_ON ? true : false; // Add true for target state
      this.platform.log.debug('Get Target State ->', state);
      callback(null, state);
    } catch (error) {
      this.platform.log.error('Failed to get target state:', error);
      callback(error as Error);
    }
  }

  /**
   * Handle GET requests for current state
   */
  async getCurrentState(callback: CharacteristicGetCallback) {
    try {
      const apiStatus = await this.checkStatusFromAPI();
      const state = apiStatus === this.FAN_ON ? true : false; // Add false for current state
      this.platform.log.debug('Get Current State ->', state);
      callback(null, state);
    } catch (error) {
      this.platform.log.error('Failed to get current state:', error);
      callback(error as Error);
    }
  }

  /**
   * Check the current climate status from the Ecobee API
   */
  private async checkStatusFromAPI(): Promise<string> {
    try {
      const needsRefresh = AuthTokenManager.getInstance().isExpired();
      if (needsRefresh) {
        await AuthTokenManager.getInstance().renewAuthToken();
      }
      const authToken = AuthTokenManager.getInstance().authToken;

      try {
        const queryRequest = await this.makeEcobeeRequest(
          () => axios.get(
            'https://api.ecobee.com/1/thermostat?format=json&body={"selection":{"selectionType":"registered","selectionMatch":"","includeEvents":true}}',
            { headers: { 'Authorization': 'Bearer ' + authToken } },
          ),
          'status check',
        );
        const queryData = queryRequest.data;

        if (!queryData || !queryData.thermostatList) {
          this.platform.log.error('Unexpected query data structure:', JSON.stringify(queryData));
          return this.FAN_AUTO;
        }

        const events = queryData.thermostatList[0].events;

        if (events.length > 0) {
          const mostRecentEvent = events[0];
          return mostRecentEvent.fan || this.FAN_AUTO;
        } else {
          return this.FAN_AUTO;
        }
      } catch (error) {
        this.platform.log.error('Failed to check status:', error);
        return this.FAN_AUTO;
      }
    } catch (error) {
      this.platform.log.error('Error in checkStatusFromAPI:', error);
      return this.FAN_AUTO;
    }
  }
}