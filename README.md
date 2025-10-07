<p align="center">
<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# Homebridge Ecobee Status Control

This Homebridge plugin provides an elegant way to control your Ecobee fan hold through HomeKit's security system interface. 

## Features

- Control your Ecobee's fan control through HomeKit's security system interface
- Real-time status updates every 30 minutes
- Support for single or multiple thermostats
- Automatic token refresh handling
- Error recovery with automatic retries

## Installation

<!-- 1. Install Homebridge (if not already installed)
2. Install this plugin:
```bash
npm i -g homebridge-ecobee-fan-control
``` -->

## Configuration

Add the `EcobeeFanControl` platform in your homebridge `config.json` file:

```json
{
  "platforms": [
    {
      "name": "Ecobee Fan Control",
      "platform": "EcobeeFanControl",
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
| `enableFanSwitch` | No | Adds a simple ON/OFF switch for Away control (default: false) |
### Getting a Refresh Token

1. Install the plugin globally:
```bash
npm i -g homebridge-ecobee-fan-control
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
