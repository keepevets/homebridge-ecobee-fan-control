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
			.setCharacteristic(this.platform.Characteristic.Model, 'Automation Controller')
			.setCharacteristic(this.platform.Characteristic.SerialNumber, 'ECOBEEAUTO1');

		if (this.platform.config.automationSwitchType === 'stateless') {
			// Use StatelessProgrammableSwitch for a button-style interface
			this.service = this.accessory.getService(this.platform.Service.StatelessProgrammableSwitch) ||
				this.accessory.addService(this.platform.Service.StatelessProgrammableSwitch);

			this.service.setCharacteristic(
				this.platform.Characteristic.ProgrammableSwitchEvent,
				this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
			);

			// Handle switch events
			this.service.getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
				.onSet(this.handleStatelessSwitch.bind(this));
		} else {
			// Use Switch for a toggle interface
			this.service = this.accessory.getService(this.platform.Service.Switch) ||
				this.accessory.addService(this.platform.Service.Switch);

			// Handle switch state changes
			this.service.getCharacteristic(this.platform.Characteristic.On)
				.onSet(this.handleSwitch.bind(this))
				.onGet(this.getSwitchState.bind(this));
		}

		// Set the service name
		this.service.setCharacteristic(
			this.platform.Characteristic.Name,
			`${accessory.context.device.displayName} Automation`,
		);
	}

	/**
	 * Handle regular switch events
	 */
	private async handleSwitch(value: CharacteristicValue) {
		const newState = value as boolean;

		try {
			// Get the security system service from the main accessory
			const securityService = this.mainAccessory.getService(this.platform.Service.SecuritySystem);
			if (!securityService) {
				throw new Error('Security service not found');
			}

			// Convert switch state to climate state
			const climateState = newState ? ClimateState.HOME : ClimateState.AWAY;

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
	 * Handle stateless switch events
	 */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	private async handleStatelessSwitch(_value: CharacteristicValue) {
		try {
			// Toggle between Home and Away
			const newState = this.lastTriggeredState === ClimateState.HOME
				? ClimateState.AWAY
				: ClimateState.HOME;

			const securityService = this.mainAccessory.getService(this.platform.Service.SecuritySystem);
			if (!securityService) {
				throw new Error('Security service not found');
			}

			await securityService.setCharacteristic(
				this.platform.Characteristic.SecuritySystemTargetState,
				this.mapClimateToSecurityState(newState),
			);

			this.lastTriggeredState = newState;
		} catch (error) {
			this.platform.log.error('Failed to handle stateless switch event:', error);
			throw error;
		}
	}

	/**
	 * Get current switch state based on climate state
	 */
	private async getSwitchState(): Promise<boolean> {
		const securityService = this.mainAccessory.getService(this.platform.Service.SecuritySystem);
		if (!securityService) {
			throw new Error('Security service not found');
		}

		const currentState = await securityService.getCharacteristic(
			this.platform.Characteristic.SecuritySystemCurrentState,
		).value;

		return this.mapSecurityToSwitchState(currentState as number);
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