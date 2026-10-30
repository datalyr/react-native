# Changelog

All notable changes to the Datalyr React Native SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] - 2026-10-30

### Changed
- The first SDK launch on a device is now classified before the SDK creates any id. The test is whether a run of the app already happened here:
    - iOS: app folders and files (WebKit, Cookies, HTTPStorages, the URL cache, the preferences plist, the top level of Documents and Application Support) were created before this process started. StoreKit 2 `AppTransaction` (iOS 16+, production only, 3 s hard cap, never `refresh()`) and the app bundle's date against the data container's are cross-checks.
    - Android: `PackageInfo` `lastUpdateTime` is later than `firstInstallTime`, and app files predate this process.
  The class is stored, so a kill before the event is queued re-fires the same class. This also fixes the RN-24 race: a kill between id creation and the install marker used to turn a real install into a silent upgrade.
- An existing user who updated into a build with the SDK no longer sends `app_install`. That launch sends `$sdk_first_launch_existing` with `install_type: existing_user`, `detection_method` and a coarse `prior_install_age`. It carries no click ids, UTMs, Play referrer or Search Ads data. Devices that ran an older DATALYR build without the marker (RN-24) also send this event now, instead of nothing.
- `app_install` now carries `install_type` (`new`, `reinstall` or `unknown`) and `detection_method`. An earlier run less than a day before this launch is `unknown`, and is still sent like an install: this covers apps that start the SDK only after consent or login.
- Android: a second install marker lives in `noBackupFilesDir`, which Auto Backup never restores. A restored DATALYR state on a fresh install (a reinstall, or a new phone, set up in the last day and never updated in place) now sends `app_install` with `install_type: reinstall`. Before, it sent nothing. The restored click ids, UTMs, journey and lookup state belong to the old install and are cleared first. An upgrade into 1.8.0 (including a phone move made on an older SDK) only gets the new marker. On later launches the check reads only the marker and the install times, with no file scan.
- For an existing user, the deferred web-to-app IP lookup is marked resolved and never runs.

### Added
- `existingUserHint` config option: a function the app can use to say whether the person already used the app before it shipped DATALYR (for example a stored login token). It is read once, on the first SDK launch only. Only `true` changes the result; `false` and `null` leave the decision to the device signals. It runs during `initialize()`, so keep it cheap and free of UI work.
- Native `getInstallSignals()` on iOS and Android, plus Android `getRestoreSignals()` and `writeInstallMarker()`. `InstallClassification` / `InstallType` types are exported. With an older native build (no rebuild) the launch is labelled `unknown` and sent as before.

### Privacy
- The iOS privacy manifest declares `NSPrivacyAccessedAPICategoryFileTimestamp` with reason `C617.1` (timestamps of files inside the app container). Raw dates never leave the device; only the age bucket does.

## [1.7.24] - 2026-10-29

### Added
- `alias(newUserId)` while a provisional id is current (and no explicit `previousId`) is a plain sign-in: it runs the no-reset identify and sends no `$alias`, because the server merges any `$alias` without the guest→account guards.
- `identify(userId, properties, { provisional: true })` (instance and static, bare and Expo) for an app's own pre-login (guest) id. While a provisional id is the current user, every event (including `$identify` and `app_install`) carries `$provisional_user_id: true`. The marker is SDK-owned: a `$provisional_user_id` passed in properties is dropped. The server reads the marker in a later release; until then the guest-to-account join runs only on workspaces where it is turned on. A provisional identify is ignored while a signed-in user is current (it never resets). The next real `identify()` replaces it without the account-switch reset (same device ids, attribution and session); replacing one provisional id with another does not reset either. The flag is stored bound to the user id (`@datalyr/user_id_provisional` = `provisional:<hash of the id>`, so a stale flag never marks a different, real user) and survives a restart; `reset()` clears it. No `$alias` is sent.
- `syncRevenueCatAttributes(handler)` and `syncSuperwallAttributes(handler)` (instance and static, bare and Expo). The handler receives `getRevenueCatAttributes()` / `getSuperwallAttributes()` once `initialize()` has finished and again, once per call, after every `reset()`, after an `identify()` that sent `$identify`, switched accounts or merged web attribution, and after `bindProviderIdentity()`. Calls run on a microtask after the DATALYR method completes. Before, `datalyr_id` set once at launch went stale after `reset()` rotated the anonymous id. Returns an unsubscribe function; registering again replaces the handler; handler errors are logged, never thrown. On login call `Purchases.logIn()` / `Superwall.shared.identify()` first, then `Datalyr.identify()`; on logout call `Purchases.logOut()` / `Superwall.shared.reset()` first, then `Datalyr.reset()`.
- `bindProviderIdentity()` knows the `iclosed`, `commas`, `hubspot` and `calendly` namespaces (13 in all, matching the server). One list is shared by both entry points.

### Changed
- The redundant-identify hash includes the provisional flag (appended only for provisional ids, so existing signed-in users do not re-send `$identify` after the update).

### Fixed
- Docs: RevenueCat's DATALYR id key is `datalyr_id` (un-prefixed), not `$datalyrId`; `datalyr_id` is the anonymous id, not the visitor id.

## [1.7.23] - 2026-10-13

### Added
- The deferred install lookup (iOS) sends the current ATT status as `att_status` (0 notDetermined, 1 restricted, 2 denied, 3 authorized), read from the native module right before the request. Omitted on Android and when the native module is unavailable.
- A workspace can match iOS installs only when ATT is authorized. The server then answers `{found: false, reason: 'att_not_authorized'}`. The SDK treats that as "not yet": the lookup stays open, the attempt is not counted, and `$attribution_match` with that reason is sent at most once per launch.
- The lookup runs again once ATT is authorized: after `updateTrackingAuthorization()`, and when the app returns to the foreground (the SDK re-reads the ATT status then). Only after the server declined that lookup for ATT (not after other open states such as an early `no_candidates` or a failed request, which keep their next-launch retry), only inside the 7-day window, while the lookup is unanswered and attempts remain; only one lookup runs at a time.
- iOS without the native module (Expo Go, missing pods) has no ATT status to send. After the server declines a lookup for ATT in that state, the SDK stops asking (no attempts spent) until a build with the native module reports a status.
- iOS refreshes advertiser info (IDFA, ATT status) every time the app becomes active, so later events carry the current values.

### Changed
- Device context is sent as `properties.device_context` instead of `properties.fingerprint`. Ingest reads both, so older builds keep working.
- The device id in the device context (`deviceId`, stored by ingest as `fingerprint_hash`) is now a random UUID created on first launch and kept in AsyncStorage, on every build. The bare React Native build used `react-native-device-info`'s `getUniqueId()` (on iOS the IDFV stored in the Keychain, which survives a reinstall; on Android `ANDROID_ID`). After updating, each existing install sends a new device id once, then keeps it; a reinstall gets a new one. The visitor id, anonymous id, user id and attribution are unchanged. Installs that already used the stored fallback id (no `react-native-device-info`) keep it.
- `$att_status` reports the status the device reports (0-3) in `status` and `att_status`, with `status_name` `notDetermined` / `restricted` / `denied` / `authorized` and `authorized: status === 3`. Before, any non-authorized answer was sent as 2 (denied). This is iOS only; on Android `$att_status` still follows the boolean argument (3 or 2). On iOS the argument is used only when the native module is unavailable.
- Renamed internals that described device context or the identify hash as a "fingerprint": `fingerprintOsVersion` / `fingerprintDeviceModel` are now `deviceOsVersion` / `deviceModelName`, and `STORAGE_KEYS.LAST_IDENTITY_FINGERPRINT` is `STORAGE_KEYS.LAST_IDENTITY_HASH`. The stored key string is unchanged, so identify de-duplication carries over.

### Fixed
- Docs: the iOS install lookup window is up to 7 days after install, not 24 hours.
- `PrivacyInfo.xcprivacy`: a comment said the ingest and API domains were listed as tracking domains. They are not, and the comment now says so; the manifest content is unchanged.

## [1.7.22] - 2026-10-11

### Added
- Snapchat click ids are kept. `ScCid` (the param Snap appends, lower-cased to `sccid` by the parser) and `sclid` are stored as `sclid`, persisted, and sent on every event. Before, `sccid` was missing from the capture list, so it only triggered `$deep_link` and was then dropped.
- AppLovin `aleid` (click id) and `alart` (app-user id) are captured from deep links, stored verbatim and persisted. `aleid` is sent on every event like the other click ids. `alart` is a persistent per-user id, so it is sent only on `app_install` and `$deep_link` (and on `$web_attribution_matched` when the lookup response itself carries one), never on general events. It is also sent only when tracking is authorized: the cached advertiser info's `att_status` must be 3 (iOS: ATT authorized; Android: advertising id available and Limit Ad Tracking off). Otherwise, or when the native module is missing (Expo Go), it stays on the device and is removed from every outgoing event, whatever its source.
- iOS privacy manifest: declares `NSPrivacyCollectedDataTypeUserID` (Linked, Tracking; Analytics + Third-Party Advertising), covering `alart` and the user id passed to `identify()`.
- The web-attribution match response (deferred IP lookup and `identify()` email lookup) now gap-fills `twclid`, `li_fat_id`, `sclid` and `aleid` into the persisted attribution and sends them on `$web_attribution_matched` (only when present; a `null` from the API adds no key). The API already returned the first three; they were dropped.
- The first/last touch carries a `clickIdType` for every click id, not only `fbclid` / `gclid` / `ttclid`. Those three keep their precedence; the rest follow the web SDK's order (`gbraid`, `wbraid`, `oppref`, `msclkid`, `twclid`, `li_fat_id`, `sclid`, `dclid`), then `aleid`. Touches also store `gbraid`, `wbraid`, `twclid`, `li_fat_id`, `sclid`, `aleid`.
- `twclid`, `li_fat_id`, `sclid`, `aleid` and `alart` deep links now fire `$deep_link`.
- A link with only a click id (any of the above, no `utm_source` / `lyr`) now records the first/last touch at startup. The gate checked only `utm_source`, `fbclid`, `gclid` and `lyr`, so e.g. a bare `?ttclid=` or `?li_fat_id=` link recorded no touch. `alart` alone still records none.

### Fixed
- The first/last touch is recorded at startup only when the attribution is newer than the last recorded touch (port of iOS FSR-34). It used to be recorded on every cold start, appending a duplicate touchpoint and rolling the 90-day last-touch expiry forward each launch; with every click id now counting, any stored click id would have done this. Deep-link capture and the web→app merge stamp `attribution_captured_at` (SDK bookkeeping, never sent). Attribution persisted before this release has no stamp and records no new touch until the next deep link or web match.
- Attribution persisted before TR-24 (only `li_click_id`) now fills `li_fat_id` on load, so LinkedIn clicks from those installs reach ingest under the key it reads. `li_click_id` is still read and still stored.

### Notes
- Raw `sccid` / `ScCid` / `li_click_id` keys (from older SDK builds or `$deep_link` params) are normalised to `sclid` / `li_fat_id` server-side by ingest. No SDK change is needed for them.

## [1.7.21] - 2026-09-03

### Fixed
- App Store upload rejected 1.7.20 with ITMS-91064: `NSPrivacyTracking` true requires a non-empty `NSPrivacyTrackingDomains`. The manifest now lists `tracking.datalyr.com` only, and the SDK sends only IDFA-bearing events (ATT already authorized) to that host; every other event still goes to `ingest.datalyr.com`, which iOS never blocks. Same backend handler.

## [1.7.20] - 2026-09-03

### Added
- `$deep_link` event (parity with the iOS SDK): tracked with the URL's attribution params whenever a deep link carries `lyr`, click ids or UTMs, so post-install re-engagement clicks have an event of their own.
- AdAttributionKit is now actually called: on iOS 17.4+ `updatePostbackConversionValue` / `updatePostbackWithWindow` send the value to both SKAdNetwork and `AdAttributionKit.Postback` (the response carries `adAttributionKitAccepted`). On iOS 18+ `updateReengagementConversionValue` sends a real re-engagement `PostbackUpdate`; on 17.4-17.x it rejects with `unsupported` instead of silently re-sending the install value. Config plugin options `attributionCopyEndpoint` (AttributionCopyEndpoint) and `reengagementPostbackCopies` (EligibleForAdAttributionKitReengagementPostbackCopies).
- Expo config plugin (`app.plugin.js`): `["@datalyr/react-native", { networks: ['meta','tiktok','google','snapchat','apple'], skAdNetworkIds, trackingUsageDescription }]` merges `SKAdNetworkItems` into `Info.plist` (deduped, existing entries kept) and sets `NSUserTrackingUsageDescription` when unset. Apple Search Ads needs no SKAdNetwork id. Android is a no-op. `@expo/config-plugins` is an optional peer.

### Fixed
- HTTP 401 from ingest no longer burns the retry budget and dead-letters cold-start events: the queue is held for a 10-minute grace window with one unconditional warning, then the permanent-4xx path applies.
- `$att_status` event also carries `att_status` (the key the Meta/Snapchat postback mappers read), alongside `status`/`status_name`.
- Android `getAdvertiserInfo` reported `att_status: 3` / tracking enabled when the advertising id was unavailable (no Play Services); now `0` / false.
- Deferred-lookup self-match guard compared the server's `visitor_id` against the internal `visitorId` (never sent); now `anonymousId`.
- Apple Search Ads keys aligned with the iOS SDK (`asa_adgroup_id`, `asa_adgroup_name`, plus `asa_attribution: true`).
- Docs: Expo Go runs events only; SKAdNetwork / IDFA / Apple Search Ads / Play Install Referrer need a development build. Bare React Native must run `npx install-expo-modules@latest` (the package is built on Expo Modules). `expo-application` / `expo-device` / `expo-network` are listed as required for the `/expo` entry point. Dropped the instruction to add `installreferrer` to the app's `build.gradle` (the library declares it). iOS 17.4+ wording is now "SKAdNetwork 4 postback APIs (AdAttributionKit-compatible)".
- HTTP 413 (payload too large) is no longer retried: the event is dead-lettered immediately with an unconditional log naming the event and its byte size, marked `permanent: true`, and skipped by dead-letter replay. `track()` drops `eventData` over 200 000 bytes before enqueue with an `errorLog`.
- `trackWithSKAdNetwork()` without `skadTemplate` now warns once per process unconditionally (was debug-only), so disabled conversion values are visible.
- `bindProviderIdentity()` warns once per unknown namespace (anything outside the server's `KNOWN_EXTERNAL_NAMESPACES`) that no webhook will join it; the event is still sent.
- iOS: `initialize()` warns once, unconditionally, when the native modules are not linked (Expo Go, or a build without `pod install`) so SKAdNetwork / IDFA / Apple Search Ads being disabled is no longer silent.
- `getSuperwallAttributes()` / `getRevenueCatAttributes()` set `datalyr_id` to the internal `visitorId`, which is never sent to the server (the wire carries `anonymousId`, stored as `visitor_id`). The webhook visitor-id leg could therefore never match. Now sends `anonymousId`.
- `alias()` defaulted `previousId` to `visitorId` (never on the wire); now `currentUserId` or `anonymousId`, so prior anonymous events actually link (port of iOS FSR-32).
- SKAdNetwork registration on iOS 17.4+ sent a `0/low` postback value on every cold launch, resetting any in-window high-water value. Registration is now once per install (persisted flag; port of iOS FSR-3).
- `PrivacyInfo.xcprivacy` no longer lists `ingest.datalyr.com` / `api.datalyr.com` under `NSPrivacyTrackingDomains`: iOS fails requests to listed domains until ATT is granted, which would block event ingest for un-prompted and denied users.
- `errorLog` (dropped events, dead-letter moves, bad keys) is now visible in release builds, not only under `__DEV__`. The Expo build (`utils-expo.ts`) had its own `__DEV__`-gated copy; it now matches.
- Event queue load now merges with events enqueued while the async load was in flight instead of replacing them.
- Apple Search Ads attribution request has a 5s timeout instead of URLSession's 60s default, so SDK init is not gated on Apple.
- Android: Play Install Referrer settles its promise on service disconnect (init could hang forever); GAID fetch catches `Throwable` (a missing ads-identifier class would have crashed the process) and filters the Android 13 zero id.
- Android in Expo apps: `expo-module.config.json` listed the React Native `DatalyrPackage` under `android.modules`, which Expo emits into its Kotlin `Module` list (a compile error) while its react-native-config resolver suppressed normal RN autolinking for the package. The config is now Apple-only, so RN autolinking registers `DatalyrPackage` (GAID, Play Install Referrer) on Android.
- Podspec now ships `PrivacyInfo.xcprivacy` as a resource bundle and declares the AdSupport / AppTrackingTransparency / StoreKit frameworks (AdServices weak-linked).
- `ConversionValueEncoder.encodeWithSKAN4`: a revenue-bearing template event (`subscribe`, `purchase`, `upgrade`) tracked without a numeric `revenue`/`value` was demoted to coarse `low`; the template's coarse value now stands unless a real amount is present.
- Expo SDK 54 autolinking (expo-modules-autolinking 3.x) never registered `DatalyrNativeModule` / `DatalyrSKAdNetworkModule`: the resolver only scans top-level subdirectories for podspecs, and ours lives at the package root. `expo-module.config.json` now uses the `apple` platform key and declares `podspecPath`, so the Expo modules provider imports the pod again (restores SKAdNetwork/AdAttributionKit registration, native IDFA and Apple Search Ads attribution in Expo apps).

## [1.7.19] - 2026-08-25

### Fixed
- **The Play install referrer delivered names and Google ids, and dropped everything
  else.** `parseReferrerUrl` kept every referrer param on `referrerData`, but
  `getAttributionData()` — the fixed-shape object spread into event payloads — forwarded
  only `utm_*` and `gclid`/`gbraid`/`wbraid`. The edge redirect has packed `dl_click_id` /
  `dl_click_id_type` into the referrer all along, so the ONE deterministic Android bridge
  was silently discarding the Meta/TikTok/Snap click id at this boundary; those installs
  fell back to the probabilistic IP match for a value they already carried. Forwarded now
  as `clickId`/`clickIdType` (the wire shape ingest maps back onto `fbclid`/`ttclid`/...),
  plus the new ad entity ids below. Keys are added only when present: this object is
  spread after persisted attribution, and an explicit `undefined` would erase a value the
  deep link or web bridge already recovered.
- **The deferred web→app lookup stopped asking two hours before the server stopped
  answering.** `DEFERRED_LOOKUP_WINDOW_MS` was 60 minutes against a server configured for
  180 (`DEFERRED_IP_MATCH_WINDOW_MINUTES` in `api/wrangler.toml`), and its comment asserted
  the server default was 60. Two thirds of the eligible window was discarded, on exactly
  the segment where the tail lives: a store download over cellular, or the ordinary
  install-now-open-later. The bound is now 180, inside the server's own 5-360 clamp so a
  raised server value cannot silently outrun it again. Kept in lockstep with the Swift
  SDK's `AttributionManager.deferredLookupWindow`.

### Fixed
- **The Android fingerprint reported an API level where a marketing version was
  expected.** Both device-info fallback paths (`utils.ts`, no react-native-device-info
  or a getter throw) send `Platform.Version`, which on Android is the SDK API level
  (34), while the server compares it against the version parsed from the CLICK's user
  agent (14). Neither the exact nor the major-version comparison could ever match, so
  the strongest single corroborating signal was dead on those paths; the same fallbacks
  emit `'Android'`/`'Unknown'` as the model, which likewise never matches real hardware.
  `fingerprintOsVersion()` now maps API level → release (omitting unmappable levels
  rather than sending a wrong one) and `fingerprintDeviceModel()` drops the placeholders.

### Added
- **Device-fingerprint matching opens the server's 7-day tier-2 window.** The deferred
  lookup now sends the device's exact os_version / model / language / timezone. The edge
  worker stamps the click-side approximations of the same signals (Accept-Language,
  UA-parsed OS/model, CF timezone/ASN) on every redirect click, and the server scores the
  overlap: store clicks up to 7 days old can now match, gated by a threshold, a margin
  over the runner-up, and at least one agreeing device signal — misses report
  `below_threshold` or `ambiguous`. The SDK's own eligibility window widens 180 min → 7
  days to match (the click history is server-side; a device offline at install can still
  recover attribution days later), and a `no_candidates` answer inside the first hour
  after install stays eligible for one more launch instead of burning the install's one
  shot on ingest lag. Old SDKs send no fingerprint, so for them the server's behavior is
  byte-identical to before.
- **`getSuperwallAttributes()` / `getRevenueCatAttributes()` carry the ad entity ids**
  (both the bare and Expo builds). Both helpers re-list fields by hand and neither was
  updated when the ids landed: they emitted `campaign`/`$campaign` (the campaign NAME)
  with no id equivalent, so a Superwall audience filter or a RevenueCat-sourced
  conversion could only ever be keyed by a name that breaks on rename. A new
  `attribution-passthrough-contract` test suite pins the contract for both builds, so
  adding a field to `AttributionData` without threading it through now fails a test.
- **Ad entity IDs cross the web→app bridge.** `campaign_id`, `adset_id`, `ad_id`,
  `placement` and `site_source_name` are merged from the lookup response into persisted
  attribution, so they ride every later event and reach the Superwall / RevenueCat
  attribute helpers. Ad identity previously reached revenue only as NAMES via the UTMs,
  and a name join back to synced spend breaks retroactively for a whole reporting period
  the moment a buyer renames a campaign mid-flight. The Android install referrer carries
  the same IDs, so a Play-referrer install gets them deterministically with no match.
  `placement` and `site_source_name` are new `AttributionData` fields; `placement` is
  Meta's placement NAME, distinct from the existing numeric `placement_id`.
- **`$attribution_match` reports every match attempt, matched or not,** in both the bare
  and Expo builds. A miss used to be a debug log and nothing else, so the only installs
  producing an event were the ones that matched, which makes the match rate uncomputable
  from event data. Carries `matched`, `reason` (`matched` / `no_candidates` /
  `no_web_traffic` / `request_failed` / `identity_only` / `self_match` / `not_enabled`),
  `match_candidates`, `match_score` and `match_window_minutes`. Deliberately separate from
  `$web_attribution_matched`, which stays the bridge event downstream readers consume and
  still fires only on a real match.

## [1.7.16] - 2026-07-25

### Fixed
- **Expo: `identify()` deduplication was dead code.** `STORAGE_KEYS.LAST_IDENTITY_FINGERPRINT`
  existed in `utils.ts` but was missing from `utils-expo.ts`, so the Expo build read and wrote
  an `undefined` storage key. AsyncStorage only warns on a non-string key, so the 1.7.15
  suppression silently no-opped on every Expo app and `reset()`'s clear did nothing. Expo now
  suppresses redundant identifies exactly as the bare build does.
- **The whole Expo half of the package is now type-checked and compiled.** `tsconfig.json`
  excluded `utils-expo.ts`, `expo.ts`, `expo-router-tracking.ts`, `datalyr-sdk-expo.ts` and
  `utils-interface.ts`, so `npm run build` never checked or emitted any of them — which is why
  the bug above shipped, and why `lib/expo.js` (the entry declared in `package.json` `exports`)
  did not exist. Ambient declarations for the optional `expo-application` / `expo-device` /
  `expo-network` peers replace the exclusion, so those files compile without forcing the Expo
  SDK into bare-RN installs.
- **A failed web-attribution lookup can retry again.** 1.7.15's redundant-identify early return
  sat before the only call site of `fetchAndMergeWebAttribution`, which marks an email "checked"
  only after an HTTP 200 precisely so a transient failure retries on the next `identify()`. That
  retry became unreachable, so a single 5xx or timeout lost web→app attribution for the lifetime
  of the install. The lookup now runs on every `identify()`; after a 200 its own marker
  short-circuits it before any network I/O, so the request volume 1.7.15 removed stays removed.
- **`DEAD_LETTER_QUEUE` added to the Expo `STORAGE_KEYS`** for parity. No runtime change — the
  shared `event-queue.ts` imports that key from `./utils` on both builds — but the drift is now
  caught by a test.

### Changed
- **The SDK version is written in exactly one place** (`src/version.ts`). It was six: the
  envelope's `context.version`, the `User-Agent`, `properties.sdk_version` on each build, and an
  `app_install`-only stamp on each. `tests/version-parity.test.ts` fails the build if any file in
  `src/` or `tests/` hardcodes it again, or if it drifts from `package.json`.
- `package-lock.json` resynced — it had been stranded at 1.7.13 through two releases.

## [1.7.15] - 2026-07-25

### Fixed
- **`identify()` no longer re-emits unchanged identity.** Apps commonly call `identify()` on
  every launch or screen; each call emitted a `$identify` event and triggered a web-attribution
  lookup even when nothing had changed. Measured in production: 6.8 identifies per visitor per
  day, worst single user 129 in 24 hours. A fingerprint of
  `visitorId | userId | sorted traits` is persisted, and an exact repeat now skips both. The
  visitor id is part of the fingerprint, so a `reset()` or reinstall always re-emits and identity
  links are never lost. (Dead on Expo until 1.7.16 — see above.)

## [1.7.14] - 2026-07-25

### Fixed
- **Identity-only and self-referential web→app matches are no longer recorded as touches.** The
  attribution lookup could return an identity match with no actual click, and the SDK recorded it
  as a web match anyway — including cases where the returned `visitor_id` was the device's own.
  Both the email and deferred/IP lookup paths now return early on `identity_only === true` and on
  a self-referential `visitor_id`.

## [1.7.13] - 2026-07-12

### Added
- **A3-25: `schema_version` envelope stamp.** Every event now carries `schema_version: 1`,
  the first canonical envelope version shared across the SDK fleet, on both the bare and Expo
  entry points, so the ingest contract layer can key on one version marker.
- **TR-18: caller-supplied `event_id` for idempotent delivery.** A non-empty string
  `properties.event_id` becomes the wire `eventId` (and is stripped from properties), mirroring
  the iOS/Node SDKs — a deterministic dedup key for a client that double-tracks a purchase
  alongside a Stripe/RevenueCat webhook. Omitted/empty → a fresh UUID. Both bare + Expo.

### Fixed
- **Track-3 review P2: event-name validation no longer silently drops previously-valid names.**
  The TR-20a tightening (`/^[A-Za-z0-9_.$-]+$/`) plus a whitespace-only `normalizeEventName` meant an
  existing app calling `track('checkout:step_1')` — or any non-ASCII name like `購入完了` — had the
  event DROPPED on upgrade (and the reject log was `__DEV__`-only, so prod was silent). The charset
  now matches iOS's Unicode alphanumerics (`/^[\p{L}\p{N}_.$-]+$/u`), and `normalizeEventName` maps
  ANY run of out-of-charset chars → a single `_` (with an always-on warn) — so `checkout:step_1` →
  `checkout_step_1` is recorded and a Unicode name passes through unchanged. Both bare + Expo.
- **BATCH-8(j): the identify-time `/attribution/lookup` request now has a 10s timeout.** Its
  sibling deferred-lookup already bounded its `fetch` with a 10s `AbortController`, but the
  email lookup (`fetchAndMergeWebAttribution`, which runs on `identify(email)` — every session)
  had none, so a stalled connection hung the promise indefinitely, leaking the socket/timer. It
  now aborts at 10s (both bare + Expo); on abort/timeout `checked` stays unset so the next
  `identify(email)` retries. (Verified `checkAppVersion` is a no-op parity concern — it's an
  exported consumer helper that the SDK never auto-invokes, and both builds already ship the same
  manual `trackAppUpdate`.)
- **TR-20: the Expo and bare entry points silently diverged.** (a) Event-name validation:
  bare accepted any non-empty string while Expo rejected anything with a space, so
  `track('Order Completed')` recorded on bare and was silently DROPPED on Expo. Both now
  normalize spaces→underscores (with a warn) and validate against one fleet charset
  (`[A-Za-z0-9_.$-]`, ≤100). (b) SKAN routing: Expo's `trackAddToCart`/`trackInitiateCheckout`/
  `trackCompleteRegistration`/`trackLead` called plain `track()` — mid-funnel conversion values
  never updated on Expo — and now route through `trackWithSKAdNetwork` like bare. (d) Session-id
  format: Expo used a bare UUID; it now uses the bare `sess_<ts>_<rand>` format so
  `context.session_id` is identical across variants. (c) E-commerce property-name parity: the
  two builds shaped the SAME conversion event with DIFFERENT keys — bare emitted
  `product_id`/`product_ids`/`product_name`/`query`/`result_ids`/`method`, Expo emitted the
  Meta-canonical `content_id`/`content_ids`/`content_name`/`search_string`/`registration_method`
  — so a dashboard or conversion-rule keyed on one spelling saw only half the fleet's traffic.
  The per-event property shaping is now a single pure module (`src/ecommerce-properties.ts`)
  imported by **both** entry points, and each builder emits BOTH the canonical Meta key (which
  the server's postback `fromAny()` reads first, and forwards verbatim to Pixel/CAPI) AND the
  legacy alias (emit-both, like the web SDK's `utm_*` / FSR-13), so every existing dashboard/rule
  keeps working. `viewContent` also now defaults `content_type` to `"product"` on Expo (bare
  already did). +7 tests, 57/57.
- **TR-24: LinkedIn clicks were never captured; Impact clicks used a non-canonical name.** The
  capture whitelist had `li_click_id` (a param LinkedIn never sends) instead of `li_fat_id`
  (LinkedIn's real param), and `irclickid` had no mapping. Now captures `li_fat_id`/`irclid`
  (canonical wire names), maps legacy `li_click_id`→`li_fat_id` and `irclickid`→`irclid`, and
  stores both old+new for one release. `li_fat_id` is also whitelisted for deep-link capture.
- **9.C.6: `identify()` traits are normalized for server-side matching.** `firstName`/`lastName`/
  `phoneNumber` now map to `first_name`/`last_name`/`phone`, and `email`/`phone` are hoisted to
  the `$identify` event root (mirrors the iOS key set) so advanced matching finds them. Both variants.
- **9.C.3: SKAdNetwork/AdAttributionKit registration now runs at init** (`registerForAttribution()`,
  iOS-only, swallow-and-log) so the first conversion-value update isn't dropped for not being
  registered. Both variants.
- **TR-21 (data loss): `app_install` could be permanently lost.** The first-launch marker
  (`@datalyr/first_launch_time`) was persisted during attribution init — *before* `app_install`
  was tracked — so a crash/kill in between made the next launch look like a returning user and
  `app_install` was never sent. The marker is now committed by `markInstallTracked()` only AFTER
  `app_install` is enqueued (in-memory `install_time`/`isInstall()` are unaffected), so an
  interrupted first launch re-fires `app_install`. Both bare + Expo.
- **TR-28 (identity bleed): `reset()` cleared attribution AFTER rotating ids, and left the
  journey.** A `track()` interleaving reset could emit the NEW visitor id with the OLD click-ids
  (crediting the new user to the old user's ad click), and the per-identity journey carried A→B.
  `reset()` now wipes attribution + `journeyManager.clearJourney()` BEFORE rotating anon/visitor/
  session ids (auto-events re-reads the id via its `getSessionId` callback). Both bare + Expo.
- **TR-08 (session corruption): the session id could rotate mid-session with no `session_start`.**
  `LAST_SESSION_TIME` was refreshed only by `getOrCreateSessionId` (init / foreground / reset) —
  never by `track()` — so after >30 min of continuous foreground use the next background→foreground
  wrongly rotated `session_id` while auto-events resumed the old session: events carried a session
  id that never got a `session_start`, and `session_end` fired with the old id, corrupting every
  session join >30 min. `track()` now refreshes `LAST_SESSION_TIME` via a throttled `touchSession()`
  (one write per 60s) in both the bare and Expo variants.
- **TR-19 (session race): `session_start` could carry the stale session id on foreground.** The
  AppState `active` handler ran `refreshSession()` and `handleAppForeground()` concurrently and
  unawaited, so on a genuine expiry `session_start` could emit with the OLD id while later events
  carried the NEW one. It now `await`s `refreshSession()` before notifying auto-events (both variants).

### Changed
- **TR-26: `ios/PrivacyInfo.xcprivacy` now accurately declares tracking.** It said
  `NSPrivacyTracking=false` with empty domains and every data type `Linked/Tracking=false`,
  while the SDK reads the IDFA when ATT-authorized, attaches it to events, and forwards
  click-ids / hashed email+phone / purchases to third-party ad CAPI. Now declares
  `NSPrivacyTracking=true`, the `ingest.datalyr.com`/`api.datalyr.com` tracking domains, and
  DeviceID / EmailAddress / PhoneNumber / PurchaseHistory / CoarseLocation / ProductInteraction
  as Linked+Tracking (Analytics + ThirdPartyAdvertising). **App Store implication:** embedding
  apps must reflect this in their App Privacy label; it reflects behavior already occurring.

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
