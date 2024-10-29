import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { ClimateState } from './types';
import { EcobeeAPIPlatform } from './platform';

export class AutomationSwitchAccessory {
	private service: Service;
	private lastTriggeredState: ClimateState = ClimateState.HOME;
	private readonly mainAccessory: PlatformAccessory;

	constructor(
		private readonly platform: EcobeeAPIPlatform,
		private readonly accessory: PlatformAccessory,
		mainAccessory: PlatformAccessory,
	) {
		this.mainAccessory = mainAccessory;

		// Set accessory information
		this.accessory.getService(this.platform.Service.AccessoryInformation)!
			.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Ecobee')
			.setCharacteristic(this.platform.Characteristic.Model, 'Away Switch')
			.setCharacteristic(this.platform.Characteristic.SerialNumber, 'ECOBEEAWAY2');

		// Use Switch for a toggle interface
		this.service = this.accessory.getService(this.platform.Service.Switch) ||
			this.accessory.addService(this.platform.Service.Switch);

		// Handle switch state changes
		this.service.getCharacteristic(this.platform.Characteristic.On)
			.onSet(this.handleSwitch.bind(this))
			.onGet(this.getSwitchState.bind(this));

		// Set the service name
		this.service.setCharacteristic(
			this.platform.Characteristic.Name,
			'Ecobee Away',
		);
	}

	/**
	 * Handle switch events
	 * ON = Away mode
	 * OFF = Home mode
	 */
	private async handleSwitch(value: CharacteristicValue) {
		const isOn = value as boolean;

		try {
			// Get the security system service from the main accessory
			const securityService = this.mainAccessory.getService(this.platform.Service.SecuritySystem);
			if (!securityService) {
				throw new Error('Security service not found');
			}

			// Convert switch state to climate state (ON = Away, OFF = Home)
			const climateState = isOn ? ClimateState.AWAY : ClimateState.HOME;

			// Update the security system state
			await securityService.setCharacteristic(
				this.platform.Characteristic.SecuritySystemTargetState,
				this.mapClimateToSecurityState(climateState),
			);

			this.lastTriggeredState = climateState;
		} catch (error) {
			this.platform.log.error('Failed to handle switch event:', error);
			throw error;
		}
	}

	/**
	 * Get current switch state based on climate state
	 * Returns true if Away, false if Home
	 */
	private async getSwitchState(): Promise<boolean> {
		const securityService = this.mainAccessory.getService(this.platform.Service.SecuritySystem);
		if (!securityService) {
			throw new Error('Security service not found');
		}

		const currentState = await securityService.getCharacteristic(
			this.platform.Characteristic.SecuritySystemCurrentState,
		).value;

		// Return true if Away, false if Home
		return currentState === this.platform.Characteristic.SecuritySystemCurrentState.AWAY_ARM;
	}

	/**
	 * Map climate state to security system state
	 */
	private mapClimateToSecurityState(climate: ClimateState): number {
		switch (climate) {
		case ClimateState.AWAY:
			return this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM;
		case ClimateState.HOME:
			return this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM;
		default:
			return this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM;
		}
	}

	/**
	 * Map security system state to switch state
	 */
	private mapSecurityToSwitchState(securityState: number): boolean {
		return securityState === this.platform.Characteristic.SecuritySystemCurrentState.STAY_ARM;
	}
}