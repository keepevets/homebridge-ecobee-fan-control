import { API, IndependentPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { FanSwitchAccessory } from './fanSwitchAccessory';
import { AuthTokenManager } from './auth-token-refresh';

/**
 * EcobeeAPIPlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class EcobeeAPIPlatform implements IndependentPlatformPlugin {
	public readonly Service: typeof Service = this.api.hap.Service;
	public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

	// this is used to track restored cached accessories
	public readonly accessories: PlatformAccessory[] = [];

	constructor(
		public readonly log: Logger,
    public readonly config: PlatformConfig & {
      refreshToken: string;
      thermostatSerialNumbers?: string;
      enableFanSwitch?: boolean;
      statusPollingMinutes?: number;
    },
		public readonly api: API,
	) {
		this.log.debug('Finished initializing platform:', this.config.name);

		AuthTokenManager.configureForPlatform(this);

		// When this event is fired it means Homebridge has restored all cached accessories from disk.
		// Dynamic Platform plugins should only register new accessories after this event was fired,
		// in order to ensure they weren't added to homebridge already. This event can also be used
		// to start discovery of new accessories.
		this.api.on('didFinishLaunching', async () => {
			this.log.debug('Executed didFinishLaunching callback');
			// load access token
      try {
        await AuthTokenManager.getInstance().renewAuthToken();

			// run the method to discover / register your devices as accessories
			this.loadControlSwitches();
		} catch (error) {
      this.log.error('Error during startup:', error);
    }
  });
  }

	/**
	 * This function is invoked when homebridge restores cached accessories from disk at startup.
	 * It should be used to setup event handlers for characteristics and update respective values.
	 */
	configureAccessory(accessory: PlatformAccessory) {
		this.log.info('Loading accessory from cache:', accessory.displayName);

		// add the restored accessory to the accessories cache so we can track if it has already been registered
		this.accessories.push(accessory);
	}

	/**
	 * This is an example method showing how to register discovered accessories.
	 * Accessories must only be registered once, previously created accessories
	 * must not be registered again to prevent "duplicate UUID" errors.
	 */
	loadControlSwitches() {
		// First, handle the main security system accessory
		const mainDevice = {
			uniqueId: 'fan-control',
			displayName: 'Ecobee Fan Control',
		};

		const mainUuid = this.api.hap.uuid.generate(mainDevice.uniqueId);
		const existingMainAccessory = this.accessories.find(accessory => accessory.UUID === mainUuid);

		let mainAccessory;

		if (existingMainAccessory) {
			this.log.info('Restoring existing accessory from cache:', existingMainAccessory.displayName);
			mainAccessory = existingMainAccessory;
			new FanSwitchAccessory(this, existingMainAccessory);
		} else {
			this.log.info('Adding new accessory:', mainDevice.displayName);
			mainAccessory = new this.api.platformAccessory(mainDevice.displayName, mainUuid);
			mainAccessory.context.device = mainDevice;
			new FanSwitchAccessory(this, mainAccessory);
			this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [mainAccessory]);
		}
	}
}