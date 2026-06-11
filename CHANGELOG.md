# Changelog

All notable changes to the Datalyr React Native SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.12] - 2026-06-10

Full-stack review (FULL_STACK_REVIEW_2026-06-10) fixes. JS-only, applied to BOTH the
React Native and Expo entry points. No native changes.

### Fixed
- **Deep-link & Play Install Referrer parsing on bare React Native (FSR-8, FSR-43).** Hermes
  ships throwing stubs for `URL.searchParams` / `URLSearchParams`, so deep-link and
  Play-referrer attribution params (lyr, fbclid, gclid, ttclid, utm_*, gbraid, wbraid) were
  silently dropped on bare RN. Replaced with a dependency-free query-string parser
  (`parseQueryString`) that decodes per component; the Play referrer is now parsed raw
  (no whole-string pre-decode that corrupted encoded `&`/`=` and threw on a stray `%`).
- **`destroy()` no longer permanently bricks the SDK (FSR-9).** `initializing` is now cleared
  in a `finally` and reset in `destroy()`, which also tears down the attribution + auto-events
  managers. A `destroy()` → `initialize()` cycle re-initializes and delivers events again.
- **`$alias` writes the correct identity link (FSR-10, FSR-40).** `createEventPayload` no
  longer clobbers the `$alias` event's `userId` with a stale identified user, and a pre-init
  `alias()` now backfills a truthy `previousId` at payload time — so `visitor_user_links` is
  written for the intended user (ingest reads camelCase `ed.userId`/`ed.previousId`).
- **Dead-letter replay (FSR-11, FSR-42).** Events that exhaust retries or evict on overflow
  are now replayed on init and on offline→online reconnect (bounded by a replay counter +
  age cap), instead of being write-only-lost. Connectivity-class failures no longer burn the
  retry budget. HTTP 429/408 are treated as retryable backpressure and honor `Retry-After`.
- **Network online-ness change detection (FSR-12).** The network manager now notifies on a
  change in the *derived* online value (`isConnected && isInternetReachable !== false`), so
  reachability-only transitions (captive portals, WiFi-without-internet) no longer leave the
  queue stuck offline or stuck online.
- **Web attribution merge completeness (FSR-37).** `mergeWebAttribution` now gap-fills
  gbraid/wbraid/fbp/_fbp/fbc/_fbc/lyr (previously dropped) and awaits the save.
- **Session correctness (FSR-38, FSR-39, FSR-98).** `session_start`/`session_end` now use the
  canonical wire `session_id`; `session_start` fires only on a genuinely new session;
  `session_end` duration is measured to last activity (excludes the background gap) and the
  `events` count is wired. Expo session timeout is now an idle/sliding window like RN.
- **`reset()` rotates the anonymous id and forces a new session (FSR-41).** Prevents logout→
  login on one device merging two users in the identity graph.
- **Journey records click-id-only deep links (FSR-44).** First/last-touch now record for the
  default Meta-ad shape (`?fbclid=...` with no UTMs).
- **Degraded device-info fallback (FSR-45).** Uses the real runtime locale instead of a
  hardcoded `en-US` (which fabricated `country=US` for every event), and persists a stable
  fallback device id.
- **Caller event fields win over persisted attribution (FSR-85).** `createEventPayload` spreads
  attribution first and caller `eventData` last; the email web-attribution path now merges
  before tracking (matching the IP path).
- **Identity / lookup robustness (FSR-94, FSR-95, FSR-96, FSR-97).** A mid-init `identify()` is
  no longer overwritten by the persisted user; the web-attribution lookup is marked checked
  only after the body parses; the queue drain measures progress by removals (so a concurrent
  enqueue can't strand a just-queued terminal event); and corrupted persisted queue entries
  are filtered on load instead of jamming the queue head.

## [1.7.8] - 2026-05-31

### Changed
- **Web→app email attribution now emits the canonical `$web_attribution_matched` event** (with `match_method: 'email'`) instead of the separate `$web_attribution_merged`. The email/`identify()` match path and the IP/deferred match path now fire the same event name, distinguished by `match_method` (`'email'` vs `'ip'`). This lets the server-side attribution bridges (Meta CAPI recovery, trackable-link `lyr`) recover web attribution for webhook conversions from email matches — previously only IP matches bridged, because no server reader consumed `$web_attribution_merged`. No API or integration changes required.

## [1.7.9] - 2026-06-03

End-to-end review pass (the first npm release to include these — the prior review fixes plus
the SKAN rebuild; 1.7.8 on npm predates them). Also bundles the earlier HIGH/MEDIUM review
fixes (singleton export, Play Install Referrer merge, rate-limiter sliding window, Expo
network wiring, locale region) that were committed under 1.7.8 but never published.
**Coordinated:** the SKAN change requires updating your SKAN dashboard schema — see
`docs-v2/SKAN_CONVERSION_VALUE_SCHEMA_2026-06-03.md`.

### Fixed (end-to-end review, 2026-06-03 — prod-verified against real RN events)
- **`session_id` now travels in `context`** (was in `properties`), where ingest's server-track handler reads it — otherwise ingest discarded the SDK's session and synthesized its own hour-bucketed one for every event.
- **`alias()` now writes identity links.** It emitted event name `alias` (ingest matches only `$alias`) with key `newUserId` (ingest reads `userId`) — so alias-based merges wrote ZERO `visitor_user_links` (confirmed in prod: 0 `alias_event` rows). Now emits `$alias` + `userId`.
- **Web→app bridge now emits `_fbp`/`_fbc`** (the Meta cookie names the attribution MV + postback extract) alongside bare `fbp`/`fbc` — the bare keys had no reader, so recovered web fbp/fbc never reached Meta CAPI (confirmed in prod: `fbp` populated, `_fbp` empty).
- **Stale version markers corrected**: `context.version` `1.7.5` → `1.7.8`, `User-Agent` `@datalyr/react-native/1.5.0` → `1.7.8`.
- **Event queue drains fully**: `flush()`/processing now loops until the queue is empty (was a single `batchSize` batch), so a backlog or the terminal `session_end` on background isn't left behind; persists per batch.
- **Dead-letter instead of silent drop**: events that exhaust retries move to a capped (`@datalyr/dead_letter_queue`, 100) store with an error log, instead of vanishing.
- **`trackPurchase`/`trackSubscription` now send `value` (and `revenue`)** so a conversion rule whose `value_path` is `value` doesn't forward a $0 conversion to ad platforms.
- **Expo parity**: the Expo SDK now fires `$att_status` (with the `initialized` guard) and `$network_status_change` — both were RN-only and silently omitted on Expo.

- **SKAdNetwork conversion-value schema rebuilt (was silently dropping purchases).** `ConversionValueEncoder.ts` assigned bits 6 & 7, which overflow the 6-bit (0–63) fine value and clamp to 63 — so `signup`/`view_item` reported a *higher* value than `purchase` (max 15). Since SKAN only revises the value upward, a signup-then-purchase user locked at 63 and the purchase + revenue were never recorded. Rewritten to the mixed model `fineValue = (funnelRank << 3) | revenueTier` (down-funnel = higher), so values fit 0–63 and `purchase` always outranks `signup`. **Coordinated release:** update your SKAN dashboard schema to the new mapping — see `docs-v2/SKAN_CONVERSION_VALUE_SCHEMA_2026-06-03.md`. (Mirrors the iOS SDK.)

### Known (flagged, not changed — require decisions)
- `mergeWebAttribution` is gap-fill-only despite a "web wins for first-touch" comment.

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
