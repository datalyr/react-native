# Changelog

All notable changes to the Datalyr React Native SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-01

### Added
- Bundled Meta (Facebook) SDK for iOS via native module
- Bundled TikTok Business SDK for iOS via native module
- Deferred deep link support for Meta attribution
- Advanced Matching support for Meta and TikTok
- Platform integration status methods
- `updateTrackingAuthorization()` for ATT handling

### Changed
- Native SDKs are now bundled via CocoaPods (no additional npm packages required)
- E-commerce events auto-forward to Meta and TikTok when available

## [1.1.0] - 2025-01

### Fixed
- Race condition during initialization where install event was tracked before SDK was ready
- Screen view events now use `pageview` (singular) to match web script
- Authentication issues with Supabase Edge Function JWT verification

### Changed
- SDK now uses server-side API endpoint by default
- API key is now required for authentication

## [1.0.0] - 2024

### Added
- Core event tracking with `track()`, `screen()`, `identify()`
- Automatic event tracking (sessions, screen views, app lifecycle)
- SKAdNetwork conversion value encoding with industry templates
- Mobile attribution tracking (UTM, click IDs)
- Event queue with offline support and batching
- React Native and Expo support
- TypeScript support
