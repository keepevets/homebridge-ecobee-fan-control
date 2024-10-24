<p align="center">
<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# Homebridge Ecobee Status Control
[![npm](https://img.shields.io/npm/v/homebridge-ecobee-status.svg)](https://www.npmjs.com/package/homebridge-ecobee-status)

This Homebridge plugin provides a security system interface to control your Ecobee thermostat's climate status (Home/Away/Sleep). It's perfect for creating automations to control your thermostat's mode based on your daily routines or other triggers.

*This is a fork of [homebridge-ecobee-away](https://www.npmjs.com/package/homebridge-ecobee-away) with added support for Sleep mode and improved state handling.*

## Features

- Control your Ecobee's status through HomeKit's security system interface
- Three state options:
  - **Home** (Stay Armed): Resumes your regular program
  - **Away** (Away Armed): Sets thermostat to Away mode
  - **Sleep** (Night Armed): Sets thermostat to Sleep mode
- Real-time status updates
- Works best with auto home/away disabled
- Support for single or multiple thermostats

## Installation

Assuming a global installation of `homebridge`:
```bash
npm i -g --unsafe-perm homebridge-ecobee-status
```

## Configuration

Add the `EcobeeStatus` platform in your homebridge `config.json` file:

```json
{
  "platforms": [
    {
      "name": "Ecobee Status",
      "platform": "EcobeeStatus",
      "refreshToken": "token generated with ecobee-auth-cli",
      "thermostatSerialNumbers": "100904852660,654234216036"
    }
  ]
}
```

### Configuration Options

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | The name that will appear in your Home app |
| `platform` | Yes | Must be "EcobeeStatus" |
| `refreshToken` | Yes | Authentication token (see below) |
| `thermostatSerialNumbers` | No | Comma-separated list of thermostats to control |

### Getting a Refresh Token

1. Install the plugin globally
2. Run `ecobee-auth-cli` from your terminal
3. Follow the prompts to:
   - Log in to your Ecobee web portal
   - Navigate to the "Apps" tab
   - Enter the provided PIN
4. Copy the generated token into your config file

The plugin will automatically handle token refreshes and update the config file as needed.

### Thermostat Serial Numbers (Optional)

If you have multiple thermostats, you can specify which ones to control by adding their serial numbers. Find these in your Ecobee app or website under each thermostat's "About" page.

Leave this field blank to control all registered thermostats.

## Usage

After installation and configuration:

1. Open the Home app
2. Find the new security system control
3. Use the states as follows:
   - Stay Armed = Home mode
   - Away Armed = Away mode
   - Night Armed = Sleep mode

The status will automatically sync between HomeKit and your Ecobee every 30 minutes.

## Troubleshooting

- **Authentication Issues**: Run `ecobee-auth-cli` again to generate a new token
- **State Sync Issues**: Check your Homebridge logs for any API errors
- **Multiple Thermostats**: Verify serial numbers are correct in config
- **Status Not Updating**: Ensure auto home/away is disabled in Ecobee settings

## Credits

This plugin is a fork of [homebridge-ecobee-away](https://www.npmjs.com/package/homebridge-ecobee-away) by the original author. Additional features and improvements have been added while maintaining compatibility with the original functionality.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
