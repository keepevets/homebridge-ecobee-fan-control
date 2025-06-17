# Changelog

All notable changes to this project will be documented in this file.

## [2.1.11] - 2025-06-17

### Fixed
- Improved handling of Ecobee API rate limits (429 errors)
- Added exponential backoff for rate limited requests
- Prevented cascading retry attempts during rate limiting
- Fixed duplicate background refresh scheduling

### Added
- Configurable status polling interval (30-1440 minutes)
- Better error messages for rate limiting scenarios
- Rate limit awareness in token refresh logic

### Changed
- Default polling interval increased from 30 to 60 minutes
- Reduced retry attempts for auth endpoints to prevent rate limits
- Increased initial retry delay for auth endpoints to 30 seconds
