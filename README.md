<p align="center">
<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# Homebridge Ecobee Status Control

[![npm](https://img.shields.io/npm/v/homebridge-ecobee-status.svg)](https://www.npmjs.com/package/homebridge-ecobee-status)

This Homebridge plugin provides an elegant way to control your Ecobee thermostat's climate status (Home/Away/Sleep) through HomeKit's security system interface. Perfect for creating automations based on your daily routines or other triggers.

## Features

- Control your Ecobee's status through HomeKit's security system interface
- Three state options:
  - **Home** (Stay Armed) - Resumes your regular program
  - **Away** (Away Armed) - Sets thermostat to Away mode
  - **Sleep** (Night Armed) - Sets thermostat to Sleep mode
- Real-time status updates every 30 minutes
- Optional automation-friendly switch for simpler Home/Away control
- Support for single or multiple thermostats
- Automatic token refresh handling
- Error recovery with automatic retries

## Installation

1. Install Homebridge (if not already installed)
2. Install this plugin:
```bash
npm i -g homebridge-ecobee-status
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
      "thermostatSerialNumbers": "100904852660,654234216036",
      "enableAutomationSwitch": false
    }
  ]
}
```

### Configuration Options

| Option | Required | Description |
|--------|----------|-------------|
| `name` | No | The name that will appear in your Home app |
| `platform` | Yes | Must be "EcobeeStatus" |
| `refreshToken` | Yes | Authentication token (see below) |
| `thermostatSerialNumbers` | No | Comma-separated list of thermostats to control |
| `enableAutomationSwitch` | No | Adds a simple ON/OFF switch for Away control (default: false) |
| `homeIndefiniteHold` | No | Use indefinite hold for Home status (default: false) |
| `awayIndefiniteHold` | No | Use indefinite hold for Away status (default: true) |
| `sleepIndefiniteHold` | No | Use indefinite hold for Sleep status (default: true) |

### Getting a Refresh Token

1. Install the plugin globally:
```bash
npm i -g homebridge-ecobee-status
```

2. Run the authentication CLI:
```bash
ecobee-auth-cli
```

3. Follow the prompts to:
   - Log in to your Ecobee web portal
   - Navigate to the "My Apps" tab
   - Enter the provided PIN
   - Authorize the application

4. Copy the generated refresh token into your config file

The plugin will automatically handle token refreshes and update the config file as needed.

### Schedule Control Options

This plugin provides fine-grained control over how each status (Home/Away/Sleep) interacts with your Ecobee's programmed schedule through three configuration options:

#### homeIndefiniteHold (Default: false)
Controls whether Home status uses an indefinite hold or resumes your Ecobee schedule:
- When false (default): Your normal Ecobee schedule runs when you're home, allowing different temperature settings for morning, afternoon, and evening
- When true: Maintains a single temperature setting when home, overriding your Ecobee schedule

#### awayIndefiniteHold (Default: true)
Controls whether Away status uses an indefinite hold or resumes your Ecobee schedule:
- When true (default): Maintains energy-saving temperatures consistently while away
- When false: Allows your Ecobee schedule to change temperatures even when you're away

#### sleepIndefiniteHold (Default: true)
Controls whether Sleep status uses an indefinite hold or resumes your Ecobee schedule:
- When true (default): Maintains your preferred sleep temperature throughout the night
- When false: Allows scheduled temperature changes during sleep hours

Example configuration:
```json
{
    "platforms": [
        {
            "name": "Ecobee Status",
            "platform": "EcobeeStatus",
            "refreshToken": "your-refresh-token",
            "homeIndefiniteHold": false,
            "awayIndefiniteHold": true,
            "sleepIndefiniteHold": true
        }
    ]
}
```

The default settings are optimized for typical use cases:
- When home: Run your normal Ecobee schedule for different times of day
- When away: Maintain energy-saving temperatures until you return
- When sleeping: Keep your preferred sleep temperature without interruption

You can adjust these settings based on your preferences. For example, if you want complete HomeKit control and prefer to override your Ecobee schedule entirely, set all options to true.

### Thermostat Serial Numbers (Optional)

If you have multiple thermostats, you can specify which ones to control by adding their serial numbers. Find these in your Ecobee app or website under each thermostat's "About" page.

Leave this field blank to control all registered thermostats.

### Automation Switch (Optional)

Enable `enableAutomationSwitch` to add a simple ON/OFF switch that controls Home/Away status. This can be useful for:
- HomeKit automations that don't support security system triggers
- Simple Home/Away control without the security system interface
- Third-party integrations

The switch states correspond to:
- ON = Away
- OFF = Home

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

## Support

- For bug reports or feature requests, please [open an issue](https://github.com/sbs44/homebridge-ecobee-status/issues)
- For questions or discussions, visit the [Discussions](https://github.com/sbs44/homebridge-ecobee-status/discussions) page

## License

This project is licensed under the Apache License, Version 2.0 - see the [LICENSE](LICENSE) file for details.

## Credits

- Original `homebridge-ecobee-away` plugin by [Vortec4800](https://github.com/Vortec4800)
- Current maintainer: [Spencer S](https://github.com/sbs44)
