# Changelog

All notable changes to the Datalyr React Native SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-03

### Removed
- **Meta (Facebook) SDK** - Removed FBSDKCoreKit (iOS) and facebook-android-sdk (Android) dependencies
- **TikTok Business SDK** - Removed TikTokBusinessSDK (iOS) and tiktok-business-android-sdk (Android) dependencies
- Removed ByteDance maven repository from Android build
- Removed `MetaConfig`, `TikTokConfig` TypeScript interfaces
- Removed `MetaNativeBridge`, `TikTokNativeBridge` native bridge modules
- Removed all client-side event forwarding to Meta/TikTok
- Removed `meta-integration.ts`, `tiktok-integration.ts`, `DatalyrObjCExceptionCatcher`

### Changed
- Conversion event routing to Meta (CAPI), TikTok (Events API), and Google Ads is now handled entirely server-side via the Datalyr postback system
- IDFA/ATT and GAID now use native Apple/Google frameworks directly
- `getPlatformIntegrationStatus()` returns only `appleSearchAds` and `playInstallReferrer`

### Migration from v1.5.x
Remove `meta` and `tiktok` config objects from your `initialize()` call:
```typescript
// Before (v1.5.x)
await Datalyr.initialize({
  apiKey: 'dk_...',
  meta: { appId: 'FB_APP_ID', clientToken: '...' },     // REMOVE
  tiktok: { appId: '...', tiktokAppId: '...' },          // REMOVE
});

// After (v1.6.0)
await Datalyr.initialize({
  apiKey: 'dk_...',
});
```
No other code changes needed. All tracking methods (`trackPurchase`, `trackAddToCart`, etc.) work the same — events are routed to ad platforms server-side via your Datalyr postback rules.

If you were importing `metaIntegration` or `tiktokIntegration` directly, remove those imports — they no longer exist.

iOS: Remove from Info.plist: `FacebookAppID`, `FacebookClientToken`, `FacebookDisplayName`, and `LSApplicationQueriesSchemes` entries for TikTok.

Android: No changes needed — Meta/TikTok dependencies are automatically removed on `pod install` / gradle sync.

## [1.3.1] - 2026-01

### Added
- **iOS 18.4+ Features** - Geo-level postbacks, development postbacks, overlapping windows
- **Privacy Manifest** (`ios/PrivacyInfo.xcprivacy`) - Required for App Store compliance
- **Network Status Detection** - Automatic online/offline handling with queue sync
- `SKAdNetworkBridge` iOS 18.4+ methods:
  - `isGeoPostbackAvailable()` - Check for geo-level postback support
  - `setPostbackEnvironment()` - Configure sandbox/production mode
  - `getEnhancedAttributionInfo()` - Full feature matrix by iOS version
  - `updatePostbackWithWindow()` - Overlapping window support
  - `enableDevelopmentMode()` / `disableDevelopmentMode()` - Convenience methods
- Migration guides from AppsFlyer and Adjust
- Comprehensive troubleshooting section in README

### Changed
- Parallel SDK initialization for faster startup
- Enhanced TypeScript types for iOS 18.4+ responses

## [1.2.1] - 2025-01

### Added
- Apple Search Ads attribution support via AdServices framework (iOS 14.3+)
- `getAppleSearchAdsAttribution()` method to retrieve attribution data
- Automatic capture of Apple Search Ads attribution on SDK initialization
- Apple Search Ads data included in all events (asa_campaign_id, asa_keyword, etc.)

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
