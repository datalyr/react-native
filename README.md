# @datalyr/react-native

Mobile analytics and attribution for React Native and Expo. Track events, identify users, and capture ad attribution.

Current release: **1.7.18**. Every event posts to `https://ingest.datalyr.com/track`.

Full reference: [docs.datalyr.com/sdk-reference/react-native](https://docs.datalyr.com/sdk-reference/react-native).

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Event Tracking](#event-tracking)
- [User Identity](#user-identity)
- [Sessions](#sessions)
- [Attribution](#attribution)
- [Customer Journey](#customer-journey)
- [Automatic Screen Tracking](#automatic-screen-tracking)
- [SKAdNetwork](#skadnetwork)
- [Ad Platform Delivery](#ad-platform-delivery)
- [Superwall and RevenueCat](#superwall-and-revenuecat)
- [Enhanced App Campaigns](#enhanced-app-campaigns)
- [Migrating from AppsFlyer or Adjust](#migrating-from-appsflyer-or-adjust)
- [Queue and Limits](#queue-and-limits)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Requirements

| Package | Version | Required |
|---|---|---|
| `react-native` | `>=0.72.0` | Yes |
| `react` | `>=18.0.0` | Yes |
| `expo-modules-core` | `>=2.0.0` | Yes, in bare React Native too |
| `@react-native-community/netinfo` | `>=11.0.0` | Optional |
| `react-native-device-info` | `>=12.0.0` | Optional |

> **Install `expo-modules-core` even in a bare React Native app.** The SDK calls `requireNativeModule` at module load. A missing package throws before `initialize()` runs.

Minimum iOS deployment target is 13.0.

---

## Installation

```bash
npm install @datalyr/react-native expo-modules-core
cd ios && pod install
```

The package bundles `@react-native-async-storage/async-storage`, `react-native-get-random-values`, and `uuid`.

Android needs no extra setup for events. For Play Install Referrer attribution, add this line to `android/app/build.gradle`:

```groovy
implementation 'com.android.installreferrer:installreferrer:2.2'
```

---

## Quick Start

```typescript
import { Datalyr } from '@datalyr/react-native';

await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  enableAutoEvents: true,
  enableAttribution: true,
});

await Datalyr.track('signup_completed', { plan: 'pro', seats: 5 });

await Datalyr.identify('user_123', { email: 'person@example.com' });

await Datalyr.trackPurchase(99.99, 'USD', 'pro_yearly');
```

Expo apps import the Expo entry point instead:

```typescript
import { Datalyr } from '@datalyr/react-native/expo';
```

> **`import Datalyr from '@datalyr/react-native'` returns the class, not the singleton.** Use the named import `{ Datalyr }` for the static facade, or `{ datalyr }` for the instance. The default import needs `new` and creates a second SDK.

The SDK buffers 50 events sent before `initialize()` resolves.

---

## Configuration

> **`timeout`, `retryDelay`, `flushInterval`, and `sessionTimeoutMs` are milliseconds on React Native.** The iOS SDK uses seconds for the first three. Copying `timeout: 15` from a Swift configuration aborts every request after 15 milliseconds.

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  timeout: 15000,
  batchSize: 10,
  flushInterval: 30000,
  maxQueueSize: 100,
});
```

| Option | Type | Default | Unit |
|---|---|---|---|
| `apiKey` | `string` | Required | — |
| `workspaceId` | `string` | `''` | — |
| `endpoint` | `string` | `'https://ingest.datalyr.com/track'` | URL |
| `useServerTracking` | `boolean` | `true` | — |
| `debug` | `boolean` | `false` | — |
| `maxRetries` | `number` | `3` | attempts |
| `retryDelay` | `number` | `1000` | **milliseconds** |
| `timeout` | `number` | `15000` | **milliseconds** |
| `batchSize` | `number` | `10` | events per queue drain |
| `flushInterval` | `number` | `30000` | **milliseconds** |
| `maxQueueSize` | `number` | `100` | events |
| `enableAutoEvents` | `boolean` | `true` | — |
| `enableAttribution` | `boolean` | `true` | — |
| `enableWebToAppAttribution` | `boolean` | Unset. Anything other than `false` turns it on. | — |
| `autoEventConfig` | `AutoEventConfig` | Unset | — |
| `skadTemplate` | `'ecommerce' \| 'gaming' \| 'subscription'` | Unset | — |

### AutoEventConfig

> **`sessionTimeoutMs` controls only the `session_start` and `session_end` events.** The `session_id` on the wire rotates on a hardcoded 30 minutes that no option changes.

| Option | Type | Default | Unit |
|---|---|---|---|
| `trackSessions` | `boolean` | `true` | — |
| `trackScreenViews` | `boolean` | `true` | — |
| `sessionTimeoutMs` | `number` | `1800000` | **milliseconds** — 30 minutes |

Update it at runtime:

```typescript
Datalyr.updateAutoEventsConfig({
  trackSessions: true,
  sessionTimeoutMs: 1800000,
});
```

### Two options that behave differently from their name

`endpoint` is discarded while `useServerTracking` is `true`, which is the default. To point at another host, set both `endpoint` and `useServerTracking: false`. That also switches authentication to `Authorization: Bearer`.

`debug` does not control logging. The log helpers test `__DEV__`. A release build prints nothing with `debug: true`, and a development build prints with `debug: false`.

### Options that do nothing

Setting any option below has no effect. Each is declared in the types and read nowhere.

| Option | Behavior the name suggests | Actual behavior |
|---|---|---|
| `apiUrl` | An alias for `endpoint` | Never read. Use `endpoint`. |
| `maxEventQueueSize` | An alias for `maxQueueSize` | Never read. Use `maxQueueSize`. |
| `retryConfig` | An object form of `maxRetries` and `retryDelay` | Never read. Use the two flat options. |
| `autoEvents` | An alias for `autoEventConfig` | Never read. Use `autoEventConfig`. |
| `respectDoNotTrack` | Honors Do Not Track | No Do Not Track logic exists. |
| `AutoEventConfig.trackAppUpdates` | Sends `app_update` automatically | Nothing auto-sends `app_update`. Call `trackAppUpdate()`. |
| `AutoEventConfig.trackPerformance` | Records performance metrics | No performance code exists. |

### getDeferredAttributionData always returns null

Use `getPlayInstallReferrer()` on Android and `getAppleSearchAdsAttribution()` on iOS.

---

## Event Tracking

### Events the SDK sends without your code

| Wire event name | Trigger |
|---|---|
| `app_install` | First launch, detected by a missing `@datalyr/first_launch_time` key |
| `session_start` | Init with a new session ID, or foreground after 30 minutes idle |
| `session_end` | Idle timeout, `destroy()`, or recovery of an abandoned session at the next init |
| `$att_status` | Every `updateTrackingAuthorization()` call |
| `$network_status_change` | The network listener reports a change after init |
| `$web_attribution_matched` | An email or IP lookup matched an earlier web visit |

There is no `app_open`, `app_foreground`, or `app_background` event. Moving to the background flushes the queue and records activity time. It sends no event.

### Events the SDK sends for you

| Method you call | Wire event name |
|---|---|
| `screen()` | `pageview` |
| `identify()` | `$identify` |
| `alias()` | `$alias` |
| `trackAppUpdate()` | `app_update` |
| `trackPurchase()` | `purchase` |
| `trackSubscription()` | `subscribe` |
| `trackAddToCart()` | `add_to_cart` |
| `trackViewContent()` | `view_content` |
| `trackInitiateCheckout()` | `initiate_checkout` |
| `trackCompleteRegistration()` | `complete_registration` |
| `trackSearch()` | `search` |
| `trackLead()` | `lead` |
| `trackAddPaymentInfo()` | `add_payment_info` |

Event names accept letters, digits, `_`, `.`, `$`, and `-`, up to 100 characters. Any other run of characters becomes a single `_`, with a console warning.

### Custom events

```typescript
await Datalyr.track('signup_started');

await Datalyr.track('product_viewed', {
  product_id: 'SKU123',
  product_name: 'Blue Shirt',
  price: 29.99,
  currency: 'USD',
});
```

### Screen views

`screen()` sends an event named `pageview`, not `screen`. Filter on `pageview` in **Events**.

```typescript
await Datalyr.screen('Home');

await Datalyr.screen('Product Details', {
  product_id: 'SKU123',
  source: 'search',
});
```

Each call attaches `screen`, `session_id`, `pageviews_in_session`, and `previous_screen`. Properties you pass win on a name collision.

### E-commerce events

```typescript
await Datalyr.trackViewContent('SKU123', 'Blue Shirt', 'product', 29.99, 'USD');
await Datalyr.trackAddToCart(29.99, 'USD', 'SKU123', 'Blue Shirt');
await Datalyr.trackInitiateCheckout(59.98, 'USD', 2, ['SKU123', 'SKU456']);
await Datalyr.trackPurchase(59.98, 'USD', 'order_123');
await Datalyr.trackSubscription(9.99, 'USD', 'monthly_pro');
await Datalyr.trackCompleteRegistration('email');
await Datalyr.trackSearch('blue shoes', ['SKU1', 'SKU2']);
await Datalyr.trackLead(100.0, 'USD');
await Datalyr.trackAddPaymentInfo(true);
```

The Expo entry point changes five signatures. Copying bare React Native code produces a type error or a missing default.

| Method | Bare React Native | Expo |
|---|---|---|
| `trackAddToCart` | `(value, currency = 'USD', productId?, productName?)` | `(value, currency, contentId?, contentName?)` — `currency` required |
| `trackViewContent` | `(contentId?, contentName?, contentType = 'product', …)` | `(contentId, contentName?, contentType?, …)` — `contentId` required, no default type |
| `trackInitiateCheckout` | `(value, currency = 'USD', …)` | `(value?, currency?, …)` — both optional, no default |
| `trackAddPaymentInfo` | `(success = true)` | `(success?)` — no default |
| `updateTrackingAuthorization` | `(enabled: boolean)` | `(authorized: boolean)` |

### Revenue

> **Do not track subscription revenue client-side when you use Superwall or RevenueCat.** `trackPurchase()` and `trackSubscription()` fire before payment is confirmed, so trials and failed payments count as revenue. Use the [Superwall](https://docs.datalyr.com/revenue/superwall) or [RevenueCat](https://docs.datalyr.com/revenue/revenuecat) webhook integration, which fires only on a confirmed charge. Use the SDK for behavioral events: `track('paywall_view')`, `screen()`, `identify()`.

This SDK has no `trackRevenue()` method. Use `track()` with your own event name.

### App updates

Nothing auto-sends `app_update`. Call it yourself.

```typescript
await Datalyr.trackAppUpdate('1.4.0', '1.5.0');
```

---

## User Identity

> **Calling `identify()` with a different user ID runs `reset()` first.** That rotates the anonymous ID and the visitor ID, and erases attribution, the journey, and SKAdNetwork state. Call `identify()` once per signed-in person, not on every screen.

```typescript
await Datalyr.identify('user_123', {
  email: 'person@example.com',
  name: 'John Doe',
  phone: '+1234567890',
  plan: 'premium',
});
```

A repeat call with an unchanged identity fingerprint sends no `$identify` event.

### Identity on the wire

| Wire field | Value |
|---|---|
| `anonymousId` | Top-level. Format `anon_<uuid>`. |
| `properties.anonymous_id` | The same value, repeated. |
| `userId` | Your ID from `identify()`. |
| `properties.sessionId` | Format `sess_<epoch_ms>_<9 base36 chars>`. |
| `context.session_id` | The same session ID. This is the field Datalyr reads. |
| `properties.fingerprint.deviceId` | A UUID for the install. |

This SDK sends no `distinct_id` and no top-level `visitor_id`. Only the Web SDK sends `distinct_id`.

### Anonymous ID

```typescript
const anonymousId = Datalyr.getAnonymousId();
// 'anon_a1b2c3d4-e5f6-7890-abcd-ef1234567890'
```

### Alias

```typescript
await Datalyr.alias('new_user_456');

await Datalyr.alias('new_user_456', 'old_user_123');
```

`alias()` links two IDs for one person. It does not run `reset()`.

### Reset

```typescript
await Datalyr.reset();
```

`reset()` rotates both the anonymous ID and the visitor ID, ends the session, and clears the user ID, user properties, attribution, the journey, and SKAdNetwork state. Call it on logout.

---

## Sessions

```typescript
const session = Datalyr.getCurrentSession();

await Datalyr.endSession();
```

A session starts on app launch and ends after 30 minutes of inactivity. `autoEventConfig.sessionTimeoutMs` changes when `session_end` fires. It does not change how the `session_id` rotates.

---

## Attribution

The SDK subscribes to `Linking` and reads the initial URL. It reads these 44 parameters from both the query string and the URL fragment. Keys are lowercased before matching.

| Group | Parameters |
|---|---|
| Datalyr | `lyr`, `datalyr`, `dl_tag`, `dl_campaign` |
| Click IDs | `fbclid`, `ttclid`, `gclid`, `wbraid`, `gbraid`, `dclid`, `twclid`, `li_fat_id`, `msclkid`, `irclid`, `click_id`, `oppref` |
| Click ID aliases | `fb_click_id` stores as `fbclid`. `tt_click_id` and `tiktok_click_id` store as `ttclid`. `li_click_id` also sets `li_fat_id`. `irclickid` also sets `irclid`. |
| Meta extras | `fb_action_ids`, `fb_action_types` |
| UTM | `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`, `utm_source_platform`, `utm_creative_format`, `utm_marketing_tactic` |
| Partner | `partner_id`, `affiliate_id`, `referrer_id`, `source_id` |
| Ad structure | `campaign_id`, `ad_id`, `adset_id`, `creative_id`, `placement_id`, `keyword`, `matchtype`, `network`, `device` |

Each `utm_*` value is mirrored to `campaign_source`, `campaign_medium`, `campaign_name`, `campaign_term`, and `campaign_content`.

```typescript
const attribution = Datalyr.getAttributionData();

await Datalyr.setAttributionData({
  utm_source: 'newsletter',
  utm_campaign: 'spring_sale',
});
```

### Install attribution

| Platform | Mechanism | Properties added |
|---|---|---|
| Android | Play Install Referrer | `install_referrer_url`, `referrer_click_timestamp`, `install_begin_timestamp`, `gclid`, `gbraid`, `wbraid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `attribution_source` |
| iOS 14.3 and later | AdServices | `asa_campaign_id`, `asa_campaign_name`, `asa_ad_group_id`, `asa_ad_group_name`, `asa_keyword_id`, `asa_keyword`, `asa_org_id`, `asa_org_name`, `asa_click_date`, `asa_conversion_type`, `asa_country_or_region` |

Play Install Referrer values merge onto an event only when the event carries neither `gclid` nor `utm_source`.

```typescript
const referrer = Datalyr.getPlayInstallReferrer();   // null on iOS
const searchAds = Datalyr.getAppleSearchAdsAttribution(); // null on Android

const status = Datalyr.getPlatformIntegrationStatus();
// { appleSearchAds: boolean, playInstallReferrer: boolean }
```

Play Install Referrer needs `implementation 'com.android.installreferrer:installreferrer:2.2'` in `android/app/build.gradle`.

### Web-to-app attribution

On Android the Web SDK's `trackAppDownloadClick()` writes attribution into the Play Store `referrer` parameter, and the SDK reads it through the Play Install Referrer API. On iOS the SDK asks the Datalyr API to match the device IP against `$app_download_click` web events from the last 24 hours.

Both run inside `initialize()`, before `app_install` fires. Your app needs no extra code.

After a match the SDK merges the web click IDs, UTM parameters, and cookies into the mobile session, sends `$web_attribution_matched`, and stamps the merged attribution on every later event.

When IP matching misses — a VPN toggle during install, for example — call `identify()` with the user's email. The SDK then recovers attribution by email.

### App Tracking Transparency

The SDK never prompts. Call the prompt yourself, then report the result.

```typescript
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';

const { granted } = await requestTrackingPermissionsAsync();
await Datalyr.updateTrackingAuthorization(granted);
```

This sends `$att_status` and refreshes `idfa`, `idfv`, `gaid`, `att_status`, and `advertiser_tracking_enabled` on later events.

---

## Customer Journey

Journey methods live on the `datalyr` instance, not on the static `Datalyr` facade.

```typescript
import { datalyr } from '@datalyr/react-native';

const summary = datalyr.getJourneySummary();
const journey = datalyr.getJourney();
```

The journey holds up to 30 touchpoints over a 90-day window. The SDK attaches no journey field to any event.

---

## Automatic Screen Tracking

> **Do not combine automatic tracking with manual `Datalyr.screen()` calls for the same screens.** Each path sends its own `pageview`, so the screen counts double.

Automatic tracking adds `source: 'auto_navigation'` or `source: 'auto_expo_router'` to the `pageview` properties.

### React Navigation

```tsx
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { datalyrScreenTracking } from '@datalyr/react-native';

function App() {
  const navigationRef = useNavigationContainerRef();
  const screenTracking = datalyrScreenTracking(navigationRef);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={screenTracking.onReady}
      onStateChange={screenTracking.onStateChange}
    >
      <RootStack />
    </NavigationContainer>
  );
}
```

Customize names, filtering, and properties:

```typescript
const screenTracking = datalyrScreenTracking(navigationRef, {
  transformScreenName: (name) => name.replace('Screen', ''),
  shouldTrackScreen: (name) => !['Splash', 'Loading'].includes(name),
  extractProperties: (name, params) => ({ product_id: params?.productId }),
});
```

Expo projects on React Navigation import the same helper from `@datalyr/react-native/expo`.

### Expo Router

```tsx
// app/_layout.tsx
import { useDatalyrScreenTracking } from '@datalyr/react-native/expo';
import { Stack } from 'expo-router';

export default function RootLayout() {
  useDatalyrScreenTracking();
  return <Stack />;
}
```

Screen names are raw pathnames, for example `/onboarding/paywall` and `/(app)/chat`. Map them to friendly names:

```tsx
useDatalyrScreenTracking({
  screenNames: { '/onboarding/paywall': 'Paywall', '/(app)/chat': 'Chat' },
  transformPathname: (path) => path.replace(/\(.*?\)\//g, ''),
  shouldTrackPath: (path) => !path.startsWith('/modal'),
});
```

### Custom tracking function

```typescript
import { createScreenTrackingListeners } from '@datalyr/react-native';

const { onReady, onStateChange } = createScreenTrackingListeners(
  navigationRef,
  (screenName, properties) => myCustomSdk.screen(screenName, properties),
);
```

---

## SKAdNetwork

iOS only. Set `skadTemplate` at initialization. Without it, `getConversionValue()` returns `null` and `trackWithSKAdNetwork()` sends no conversion update.

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  skadTemplate: 'ecommerce',
});

await Datalyr.trackWithSKAdNetwork('purchase', { value: 99.99 });

const value = Datalyr.getConversionValue('purchase', { value: 49.99 });
// 0 to 63, or null when skadTemplate is unset
```

| Template | Events |
|---|---|
| `ecommerce` | purchase, add_to_cart, begin_checkout, signup, subscribe, view_item |
| `gaming` | level_complete, tutorial_complete, purchase, achievement_unlocked |
| `subscription` | trial_start, subscribe, upgrade, cancel, signup |

The fine value is `(rank & 0x7) << 3 | revenueTier`, clamped to 0 through 63. Revenue tiers run under 1, 5, 10, 25, 50, 100, and 250, then 7 above 250. The coarse value is low under 10, medium under 50, and high above. A cross-launch high-water guard stops any decrease. `reset()` clears it.

---

## Ad Platform Delivery

Datalyr sends conversions to ad platforms server-side. Your app needs no Facebook, TikTok, Google, or OpenAI SDK. The mobile SDK captures click IDs and identity; the Datalyr backend hashes the personal data and calls each platform API.

| Platform | API | Click ID the SDK captures | Cookie the Web SDK adds |
|---|---|---|---|
| Meta | [Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api/) | `fbclid` | `_fbc`, `_fbp` |
| TikTok | [Events API](https://business-api.tiktok.com/portal/docs?id=1741601162187777) | `ttclid` | `_ttp` |
| Google Ads | [Google Ads API](https://developers.google.com/google-ads/api/docs/conversions/overview) | `gclid`, `gbraid`, `wbraid` | — |
| OpenAI Ads | [OpenAI Conversions API](https://developers.openai.com/ads/conversions-api) | `oppref` | `__oppref` |

Set each one up in **Sources**, then create a rule in **Conversions** that maps your Datalyr event to the platform event. For example, map `purchase` to Meta `Purchase`, TikTok `CompletePayment`, or OpenAI `order_created`.

Without a conversion rule, the platform receives nothing, even when the SDK captures every click ID.

---

## Superwall and RevenueCat

Call both methods after the two SDKs initialize, and again after the ATT prompt resolves.

```typescript
import { Datalyr } from '@datalyr/react-native';
import Superwall from '@superwall/react-native-superwall';
import Purchases from 'react-native-purchases';

Superwall.setUserAttributes(Datalyr.getSuperwallAttributes());
await Purchases.setAttributes(Datalyr.getRevenueCatAttributes());
```

Both methods return `Record<string, string>` and omit every empty value.

### getSuperwallAttributes

| Key | Value |
|---|---|
| `datalyr_id` | The visitor ID |
| `media_source` | `utm_source` |
| `campaign` | `utm_campaign` |
| `adgroup` | `adset_id`, or `utm_content` when `adset_id` is empty |
| `ad` | `ad_id` |
| `keyword` | `keyword` |
| `network` | `network` |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | UTM parameters |
| `lyr` | Datalyr tracking link ID |
| `fbclid`, `gclid`, `ttclid` | Ad click IDs |
| `idfa` | Apple advertising ID, only when ATT is authorized |
| `gaid` | Google advertising ID, Android only |
| `att_status` | `notDetermined`, `restricted`, `denied`, or `authorized` |

### getRevenueCatAttributes

Reserved keys:

| Key | Value |
|---|---|
| `$datalyrId` | The visitor ID |
| `$mediaSource` | `utm_source` |
| `$campaign` | `utm_campaign` |
| `$adGroup` | `adset_id` |
| `$ad` | `ad_id` |
| `$keyword` | `keyword` |
| `$idfa` | Apple advertising ID, only when ATT is authorized |
| `$gpsAdId` | Google advertising ID, Android only |
| `$attConsentStatus` | `notDetermined`, `restricted`, `denied`, or `authorized` |

Custom keys:

| Key | Value |
|---|---|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | UTM parameters |
| `lyr` | Datalyr tracking link ID |
| `fbclid`, `gclid`, `ttclid`, `wbraid`, `gbraid` | Ad click IDs |
| `network` | Ad network |
| `creative_id` | Ad creative ID |

Neither method returns `oppref`.

Datalyr also receives Superwall and RevenueCat events through server-side webhooks. The SDK methods and the webhooks are independent — use one or both.

---

## Enhanced App Campaigns

Run app ads as web campaigns (Meta Sales, TikTok Website Conversions, Google Ads) that land on a page you own and then send the user to the app store. Ad platforms treat that traffic as a website campaign, so there is no per-campaign ad set cap.

1. The user clicks your ad and lands on your domain, which loads the Datalyr Web SDK (`dl.js`).
2. The Web SDK captures `fbclid`, `ttclid`, `gclid`, `oppref`, UTM parameters, and the `_fbp`, `_fbc`, `_ttp`, and `__oppref` cookies.
3. `trackAppDownloadClick()` fires and sends the user to the app store.
4. After install, the mobile SDK matches through the Play Store referrer on Android, or IP matching on iOS.
5. In-app events fire, and conversion rules deliver them to each platform server-side.

### Create the link

In Datalyr, open **Track**, create a link, and choose **App Link**. Enter your prelander URL. The app store URL goes in your page code, inside `trackAppDownloadClick()`.

### Host the page

> **The page must run JavaScript.** A server-side redirect — 301, 302, nginx, or a Cloudflare Page Rule — never loads `dl.js`, so attribution is lost. Host the page on your own domain, not on `datalyr.com`.

#### Prelander

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Download Your App</title>
  <script src="https://track.datalyr.com/dl.js" data-workspace-id="YOUR_WORKSPACE_ID"></script>
</head>
<body>
  <h1>Download Our App</h1>
  <button id="ios-download">Download for iOS</button>
  <button id="android-download">Download for Android</button>

  <script>
    document.getElementById('ios-download').addEventListener('click', function () {
      Datalyr.trackAppDownloadClick({
        targetPlatform: 'ios',
        appStoreUrl: 'https://apps.apple.com/app/idXXXXXXXXXX'
      });
    });
    document.getElementById('android-download').addEventListener('click', function () {
      Datalyr.trackAppDownloadClick({
        targetPlatform: 'android',
        appStoreUrl: 'https://play.google.com/store/apps/details?id=com.example.app'
      });
    });
  </script>
</body>
</html>
```

#### Redirect page

> **Meta flags redirect pages with no visible content as low-quality or cloaking.** Use the prelander when ad platform compliance matters.

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://track.datalyr.com/dl.js" data-workspace-id="YOUR_WORKSPACE_ID"></script>
  <script>
    window.addEventListener('DOMContentLoaded', function () {
      var isAndroid = /android/i.test(navigator.userAgent);
      Datalyr.trackAppDownloadClick({
        targetPlatform: isAndroid ? 'android' : 'ios',
        appStoreUrl: isAndroid
          ? 'https://play.google.com/store/apps/details?id=com.example.app'
          : 'https://apps.apple.com/app/idXXXXXXXXXX'
      });
    });
  </script>
</head>
<body></body>
</html>
```

The redirect page adds roughly 100 to 200 ms while `dl.js` loads. The prelander adds none, because the user clicks a button.

### Campaign settings

| Platform | Objective | Destination | UTM template |
|---|---|---|---|
| Meta | Sales, conversion location Website, mobile placements only | Your page URL as **Website URL** | `?utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}` |
| TikTok | Website Conversions | Your page URL | `?utm_source=tiktok&utm_medium=cpc&utm_campaign=__CAMPAIGN_NAME__&utm_content=__AID_NAME__&utm_term=__CID_NAME__` |
| Google Ads | Performance Max or Search | Your page URL as the landing page | `?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}` |

---

## Migrating from AppsFlyer or Adjust

```typescript
// AppsFlyer
appsFlyer.logEvent('af_purchase', { af_revenue: 99.99, af_currency: 'USD' });

// Adjust
const event = new AdjustEvent('abc123');
event.setRevenue(99.99, 'USD');
Adjust.trackEvent(event);

// Datalyr
await Datalyr.trackPurchase(99.99, 'USD', 'pro_yearly');
```

| AppsFlyer | Adjust | Datalyr |
|---|---|---|
| `af_purchase` | `PURCHASE` | `trackPurchase()` |
| `af_add_to_cart` | `ADD_TO_CART` | `trackAddToCart()` |
| `af_initiated_checkout` | `INITIATE_CHECKOUT` | `trackInitiateCheckout()` |
| `af_complete_registration` | `COMPLETE_REGISTRATION` | `trackCompleteRegistration()` |
| `af_content_view` | `VIEW_CONTENT` | `trackViewContent()` |
| `af_subscribe` | `SUBSCRIBE` | `trackSubscription()` |

1. Remove the old package: `npm uninstall react-native-appsflyer`.
2. Install Datalyr: `npm install @datalyr/react-native expo-modules-core`.
3. Run `cd ios && pod install`.
4. Replace initialization and event calls.
5. Open **Events** in Datalyr and confirm `app_install` arrives.

---

## Queue and Limits

> **Nothing batches over the network.** The queue drains `batchSize` events per pass, then sends one HTTP request per event. There is no batch endpoint, and `batchSize` is not a send threshold — every `enqueue()` triggers a send while online.

| Limit | Value |
|---|---|
| Events drained per pass | 10, from `batchSize` |
| HTTP requests per drain | One per event |
| Flush interval | 30,000 ms |
| Retries per event | 3 |
| Retry backoff | `2^n × retryDelay + random(0…1000)` ms, capped at 30,000 ms |
| `Retry-After` honored | Capped at 30,000 ms |
| Request timeout | 15,000 ms |
| Client rate limit | 100 requests per 60,000 ms. The SDK waits, up to 60,100 ms. |
| Queue | 100 events |
| Dead-letter queue | 100 events, 3 replays each, discarded after 7 days |
| Pre-init buffer | 50 events |
| Event name | 100 characters |
| Journey | 30 touchpoints over 90 days |
| Attribution lookup timeout | 10,000 ms |

| Response | Behavior |
|---|---|
| `429`, `408` | Retried with backoff, honoring `Retry-After` |
| `401`, other `4xx` | Dropped. A wrong API key produces this. |
| `5xx`, network failure, timeout | Retried up to `maxRetries`, then moved to the dead-letter queue |

Events persist in AsyncStorage across app restarts and send when connectivity returns.

```typescript
await Datalyr.flush();

const status = Datalyr.getStatus();
console.log(status.initialized);
console.log(status.queueStats.queueSize);
console.log(status.queueStats.isOnline);
```

---

## API Reference

Every method below is static on `Datalyr`, except where marked.

| Method | Signature |
|---|---|
| `initialize` | `(config: DatalyrConfig) => Promise<void>` |
| `track` | `(eventName: string, eventData?: EventData) => Promise<void>` |
| `screen` | `(screenName: string, properties?: EventData) => Promise<void>` |
| `identify` | `(userId: string, properties?: UserProperties) => Promise<void>` |
| `alias` | `(newUserId: string, previousId?: string) => Promise<void>` |
| `reset` | `() => Promise<void>` |
| `flush` | `() => Promise<void>` |
| `destroy` | `() => void` — instance only |
| `getStatus` | `() => { initialized, workspaceId, visitorId, anonymousId, sessionId, currentUserId?, queueStats, attribution, journey }` |
| `getAnonymousId` | `() => string` |
| `getAttributionData` | `() => AttributionData` |
| `setAttributionData` | `(data: Partial<AttributionData>) => Promise<void>` |
| `getDeferredAttributionData` | `() => DeferredDeepLinkResult \| null` — always `null` |
| `getJourney` | `() => TouchPoint[]` — instance only |
| `getJourneySummary` | `() => JourneySummary` — instance only |
| `getCurrentSession` | `() => SessionData \| null` |
| `endSession` | `() => Promise<void>` |
| `updateAutoEventsConfig` | `(config: Partial<AutoEventConfig>) => void` |
| `trackAppUpdate` | `(previousVersion: string, currentVersion: string) => Promise<void>` |
| `trackWithSKAdNetwork` | `(event: string, properties?: EventData) => Promise<void>` |
| `trackPurchase` | `(value: number, currency = 'USD', productId?: string) => Promise<void>` |
| `trackSubscription` | `(value: number, currency = 'USD', plan?: string) => Promise<void>` |
| `trackAddToCart` | `(value: number, currency = 'USD', productId?: string, productName?: string) => Promise<void>` |
| `trackViewContent` | `(contentId?: string, contentName?: string, contentType = 'product', value?: number, currency?: string) => Promise<void>` |
| `trackInitiateCheckout` | `(value: number, currency = 'USD', numItems?: number, productIds?: string[]) => Promise<void>` |
| `trackCompleteRegistration` | `(method?: string) => Promise<void>` |
| `trackSearch` | `(query: string, resultIds?: string[]) => Promise<void>` |
| `trackLead` | `(value?: number, currency?: string) => Promise<void>` |
| `trackAddPaymentInfo` | `(success = true) => Promise<void>` |
| `getConversionValue` | `(event: string, properties?: Record<string, any>) => number \| null` |
| `getPlatformIntegrationStatus` | `() => { appleSearchAds: boolean; playInstallReferrer: boolean }` |
| `getAppleSearchAdsAttribution` | `() => AppleSearchAdsAttribution \| null` |
| `getPlayInstallReferrer` | `() => Record<string, any> \| null` — instance, and static on the Expo entry point |
| `getSuperwallAttributes` | `() => Record<string, string>` |
| `getRevenueCatAttributes` | `() => Record<string, string>` |
| `updateTrackingAuthorization` | `(enabled: boolean) => Promise<void>` |

### TypeScript

```typescript
import {
  Datalyr,
  datalyr,
  DatalyrConfig,
  EventData,
  UserProperties,
  AttributionData,
  AutoEventConfig,
  DeferredDeepLinkResult,
} from '@datalyr/react-native';
```

---

## Troubleshooting

### No events in the dashboard

1. Confirm the API key starts with `dk_`.
2. Read `Datalyr.getStatus().initialized`.
3. Read `Datalyr.getStatus().queueStats.queueSize`. A queue that grows without draining means the API key is wrong.
4. Call `Datalyr.flush()`.
5. Open **Events** in Datalyr and filter on `app_install`.

Log lines carry a `[Datalyr]` prefix. They print only in a development build, because the log helpers test `__DEV__`. Setting `debug: true` does not turn them on in a release build.

### Screen views are missing

Filter on `pageview`, not `screen`. `screen()` sends the event name `pageview`.

### Duplicate screen views

Automatic screen tracking and manual `Datalyr.screen()` calls each send their own `pageview`. Use one path per screen.

### Attribution is empty

1. Confirm `enableAttribution` is `true`.
2. Read `Datalyr.getPlatformIntegrationStatus()`.
3. On Android, confirm `installreferrer:2.2` is in `android/app/build.gradle`.
4. On iOS, confirm the device runs 14.3 or later for Apple Search Ads.
5. Call `identify()` with the user's email as the IP-match fallback.

`getDeferredAttributionData()` always returns `null`. Use `getPlayInstallReferrer()` or `getAppleSearchAdsAttribution()`.

### Events go to the wrong host

`endpoint` is ignored while `useServerTracking` is `true`. Set `useServerTracking: false` alongside `endpoint`.

### Conversion values never update

1. Confirm `skadTemplate` is set in the config.
2. Call `trackWithSKAdNetwork()` rather than `track()`.
3. Confirm the device runs iOS 14.0 or later, and 16.1 or later for SKAN 4.0.

### iOS build errors

```bash
cd ios
pod deintegrate
pod cache clean --all
pod install
```

Full reset:

```bash
rm -rf node_modules ios/Pods ios/Podfile.lock
npm install && cd ios && pod install
```

### Android build errors

```bash
cd android && ./gradlew clean
npx react-native run-android
```

### The app throws before initialize() runs

Install `expo-modules-core`. The SDK calls `requireNativeModule` at module load, in bare React Native too.

---

## License

MIT
