# @datalyr/react-native

Mobile analytics and attribution SDK for React Native and Expo. Track events, identify users, and capture attribution data from ad platforms.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Configuration](#configuration)
- [Event Tracking](#event-tracking)
  - [Custom Events](#custom-events)
  - [Screen Views](#screen-views)
  - [E-Commerce Events](#e-commerce-events)
- [User Identity](#user-identity)
  - [Anonymous ID](#anonymous-id)
  - [Identifying Users](#identifying-users)
  - [User Properties](#user-properties)
- [Attribution](#attribution)
  - [Automatic Capture](#automatic-capture)
  - [Web-to-App Attribution](#web-to-app-attribution)
- [Event Queue](#event-queue)
- [Auto Events](#auto-events)
- [SKAdNetwork](#skadnetwork)
- [Platform Integrations](#platform-integrations)
  - [Meta (Facebook)](#meta-facebook)
  - [TikTok](#tiktok)
  - [Google Ads](#google-ads)
  - [Apple Search Ads](#apple-search-ads)
- [Enhanced App Campaigns](#enhanced-app-campaigns)
- [Third-Party Integrations](#third-party-integrations)
  - [Superwall](#superwall)
  - [RevenueCat](#revenuecat)
- [Migrating from AppsFlyer / Adjust](#migrating-from-appsflyer--adjust)
- [Expo Support](#expo-support)
- [TypeScript](#typescript)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Installation

```bash
npm install @datalyr/react-native
```

### iOS Setup

```bash
cd ios && pod install
```

### Android Setup

No additional setup required.

---

## Quick Start

```typescript
import { Datalyr } from '@datalyr/react-native';

// Initialize
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  enableAutoEvents: true,
  enableAttribution: true,
});

// Track events
await Datalyr.track('button_clicked', { button: 'signup' });

// Identify users
await Datalyr.identify('user_123', { email: 'user@example.com' });

// Track purchases
await Datalyr.trackPurchase(99.99, 'USD', 'product_123');
```

---

## How It Works

The SDK collects events and sends them to the Datalyr backend for analytics and attribution.

### Data Flow

1. Events are created with `track()`, `screen()`, or e-commerce methods
2. Each event includes device info, session data, and attribution parameters
3. Events are queued locally and sent in batches
4. If offline, events are stored and sent when connectivity returns
5. Events are processed server-side for analytics and attribution reporting

### Event Payload

Every event includes:

```typescript
{
  event: 'purchase',              // Event name
  properties: { ... },            // Custom properties

  // Identity
  anonymous_id: 'uuid',           // Persistent device ID
  user_id: 'user_123',            // Set after identify()
  session_id: 'uuid',             // Current session

  // Device
  platform: 'ios',
  device_model: 'iPhone 14',
  os_version: '17.0',
  app_version: '1.2.0',

  // Attribution (if captured)
  utm_source: 'facebook',
  fbclid: 'abc123',

  // Timestamps
  timestamp: '2024-01-15T10:30:00Z',
}
```

---

## Configuration

```typescript
await Datalyr.initialize({
  // Required
  apiKey: string,

  // Features
  debug?: boolean,                   // Console logging
  enableAutoEvents?: boolean,        // Track app lifecycle
  enableAttribution?: boolean,       // Capture attribution data

  // Event Queue
  batchSize?: number,                // Events per batch (default: 10)
  flushInterval?: number,            // Send interval ms (default: 30000)
  maxQueueSize?: number,             // Max queued events (default: 100)

  // iOS
  skadTemplate?: 'ecommerce' | 'gaming' | 'subscription',

});
```

---

## Event Tracking

### Custom Events

Track any action in your app:

```typescript
// Simple event
await Datalyr.track('signup_started');

// Event with properties
await Datalyr.track('product_viewed', {
  product_id: 'SKU123',
  product_name: 'Blue Shirt',
  price: 29.99,
  currency: 'USD',
  category: 'Apparel',
});

// Event with value
await Datalyr.track('level_completed', {
  level: 5,
  score: 1250,
  time_seconds: 120,
});
```

### Screen Views

Track navigation:

```typescript
await Datalyr.screen('Home');

await Datalyr.screen('Product Details', {
  product_id: 'SKU123',
  source: 'search',
});
```

### E-Commerce Events

Standard e-commerce events:

```typescript
// View product
await Datalyr.trackViewContent('SKU123', 'Blue Shirt', 'product', 29.99, 'USD');

// Add to cart
await Datalyr.trackAddToCart(29.99, 'USD', 'SKU123', 'Blue Shirt');

// Start checkout
await Datalyr.trackInitiateCheckout(59.98, 'USD', 2, ['SKU123', 'SKU456']);

// Complete purchase
await Datalyr.trackPurchase(59.98, 'USD', 'order_123');

// Subscription
await Datalyr.trackSubscription(9.99, 'USD', 'monthly_pro');

// Registration
await Datalyr.trackCompleteRegistration('email');

// Search
await Datalyr.trackSearch('blue shoes', ['SKU1', 'SKU2']);

// Lead
await Datalyr.trackLead(100.0, 'USD');

// Payment info
await Datalyr.trackAddPaymentInfo(true);
```

---

## User Identity

### Anonymous ID

Every device gets a persistent anonymous ID on first launch:

```typescript
const anonymousId = Datalyr.getAnonymousId();
// 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
```

This ID:
- Persists across app sessions
- Links events before and after user identification
- Can be passed to your backend for server-side attribution

### Identifying Users

Link the anonymous ID to a known user:

```typescript
await Datalyr.identify('user_123', {
  email: 'user@example.com',
});
```

After `identify()`:
- All future events include `user_id`
- Historical anonymous events can be linked server-side

### User Properties

Pass any user attributes:

```typescript
await Datalyr.identify('user_123', {
  // Standard fields
  email: 'user@example.com',
  name: 'John Doe',
  phone: '+1234567890',

  // Custom fields
  plan: 'premium',
  company: 'Acme Inc',
  signup_date: '2024-01-15',
});
```

### Logout

Clear user data on logout:

```typescript
await Datalyr.reset();
```

This:
- Clears the user ID
- Starts a new session
- Keeps the anonymous ID (same device)

---

## Attribution

### Automatic Capture

The SDK captures attribution from deep links and referrers:

```typescript
const attribution = Datalyr.getAttributionData();
```

Captured parameters:

| Type | Parameters |
|------|------------|
| UTM | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` |
| Click IDs | `fbclid`, `gclid`, `ttclid`, `twclid`, `li_click_id`, `msclkid` |
| Campaign | `campaign_id`, `adset_id`, `ad_id` |

### Web-to-App Attribution

Automatically recover attribution from a web prelander when users install the app from an ad.

**How it works:**
- **Android**: Attribution params are passed through the Play Store `referrer` URL parameter (set by the web SDK's `trackAppDownloadClick()`). The mobile SDK reads these via the Play Install Referrer API — deterministic, ~95% accuracy.
- **iOS**: On first install, the SDK calls the Datalyr API to match the device's IP against recent `$app_download_click` web events within 24 hours — ~90%+ accuracy for immediate installs.

No additional mobile code is needed. Attribution is recovered automatically during `initialize()` on first install, before the `app_install` event fires.

After a match, the SDK:
1. Merges web attribution (click IDs, UTMs, cookies) into the mobile session
2. Tracks a `$web_attribution_matched` event for analytics
3. All subsequent events (including purchases) carry the matched attribution

**Fallback:** If IP matching misses (e.g., VPN toggle during install), email-based attribution is still recovered when `identify()` is called with the user's email.

### Manual Attribution

Set attribution programmatically:

```typescript
await Datalyr.setAttributionData({
  utm_source: 'newsletter',
  utm_campaign: 'spring_sale',
});
```

---

## Event Queue

Events are batched for efficiency and offline support.

### Configuration

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  batchSize: 10,           // Send when 10 events queued
  flushInterval: 30000,    // Or every 30 seconds
  maxQueueSize: 100,       // Max events to store offline
});
```

### Manual Flush

Send all queued events immediately:

```typescript
await Datalyr.flush();
```

### Queue Status

```typescript
const status = Datalyr.getStatus();
console.log(status.queueStats.queueSize);  // Events waiting
console.log(status.queueStats.pending);    // Events being sent
```

### Offline Support

When the device is offline:
- Events are stored locally
- Queue persists across app restarts
- Events are sent when connectivity returns

---

## Auto Events

Enable automatic lifecycle tracking:

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  enableAutoEvents: true,
});
```

| Event | Trigger |
|-------|---------|
| `app_install` | First app open |
| `app_open` | App launch |
| `app_background` | App enters background |
| `app_foreground` | App returns to foreground |
| `app_update` | App version changes |
| `session_start` | New session begins |
| `session_end` | Session expires (30 min inactivity) |

---

## SKAdNetwork

iOS conversion tracking with Apple's SKAdNetwork:

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  skadTemplate: 'ecommerce',
});

// E-commerce events update conversion values
await Datalyr.trackPurchase(99.99, 'USD');
```

| Template | Events |
|----------|--------|
| `ecommerce` | purchase, add_to_cart, begin_checkout, signup, subscribe, view_item |
| `gaming` | level_complete, tutorial_complete, purchase, achievement_unlocked |
| `subscription` | trial_start, subscribe, upgrade, cancel, signup |

---

## Platform Integrations

Conversion events are routed to ad platforms server-side via the Datalyr postback system. No client-side ad SDKs (Facebook SDK, TikTok SDK, etc.) are needed in your app. The SDK captures click IDs and attribution data from ad URLs, then the backend handles hashing, formatting, and sending conversions to each platform's API.

### Meta (Facebook)

Conversions are sent to Meta via the [Conversions API (CAPI)](https://developers.facebook.com/docs/marketing-api/conversions-api/).

**What the SDK does:** Captures `fbclid` from ad click URLs, collects IDFA (when ATT authorized on iOS), and sends user data (email, phone) with events.

**What the backend does:** Hashes PII (SHA-256), formats the CAPI payload, and sends conversions with the `fbclid` and `_fbc`/`_fbp` cookies for matching.

**Setup:**
1. Connect your Meta ad account in the Datalyr dashboard (Settings > Connections)
2. Select your Meta Pixel
3. Create postback rules to map events (e.g., `purchase` → `Purchase`, `lead` → `Lead`)

No Facebook SDK needed in your app. No `Info.plist` changes, no `FacebookAppID`.

### TikTok

Conversions are sent to TikTok via the [Events API](https://business-api.tiktok.com/portal/docs?id=1741601162187777).

**What the SDK does:** Captures `ttclid` from ad click URLs and collects device identifiers (IDFA on iOS, GAID on Android).

**What the backend does:** Hashes user data, formats the Events API payload, and sends conversions with the `ttclid` and `_ttp` cookie for matching.

**Setup:**
1. Connect your TikTok Ads account in the Datalyr dashboard (Settings > Connections)
2. Select your TikTok Pixel
3. Create postback rules to map events (e.g., `purchase` → `CompletePayment`, `add_to_cart` → `AddToCart`)

No TikTok SDK needed in your app. No access tokens, no native configuration.

### Google Ads

Conversions are sent to Google via the [Google Ads API](https://developers.google.com/google-ads/api/docs/conversions/overview).

**What the SDK does:** Captures `gclid`, `gbraid`, and `wbraid` from ad click URLs. Collects user data for enhanced conversions.

**What the backend does:** Hashes user data, maps events to Google conversion actions, and sends conversions with click IDs for attribution.

**Setup:**
1. Connect your Google Ads account in the Datalyr dashboard (Settings > Connections)
2. Select your conversion actions
3. Create postback rules to map events (e.g., `purchase` → your Google conversion action)

No Google SDK needed in your app beyond the Play Install Referrer (already included for Android).

### Apple Search Ads

Attribution for users who install from Apple Search Ads (iOS 14.3+). Automatically fetched on initialization.

```typescript
// Check if user came from Apple Search Ads
const asaAttribution = Datalyr.getAppleSearchAdsAttribution();

if (asaAttribution?.attribution) {
  console.log(asaAttribution.campaignId);    // Campaign ID
  console.log(asaAttribution.campaignName);  // Campaign name
  console.log(asaAttribution.adGroupId);     // Ad group ID
  console.log(asaAttribution.keyword);       // Search keyword
  console.log(asaAttribution.clickDate);     // Click date
}
```

Attribution data is automatically included in all events with the `asa_` prefix:
- `asa_campaign_id`, `asa_campaign_name`
- `asa_ad_group_id`, `asa_ad_group_name`
- `asa_keyword_id`, `asa_keyword`
- `asa_org_id`, `asa_org_name`
- `asa_click_date`, `asa_conversion_type`

No additional configuration needed. The SDK uses Apple's AdServices API.

### App Tracking Transparency

Update after ATT dialog:

```typescript
const { status } = await requestTrackingPermissionsAsync();
await Datalyr.updateTrackingAuthorization(status === 'granted');
```

### Check Status

```typescript
const status = Datalyr.getPlatformIntegrationStatus();
// { appleSearchAds: true }
```

---

## Expo Support

```typescript
import { Datalyr } from '@datalyr/react-native/expo';
```

Same API as standard React Native.

---

## TypeScript

```typescript
import {
  Datalyr,
  DatalyrConfig,
  EventData,
  UserProperties,
  AttributionData,
} from '@datalyr/react-native';
```

---

## Migrating from AppsFlyer / Adjust

Datalyr provides similar functionality with a simpler integration.

### From AppsFlyer

```typescript
// BEFORE: AppsFlyer
import appsFlyer from 'react-native-appsflyer';
appsFlyer.logEvent('af_purchase', { af_revenue: 99.99, af_currency: 'USD' });

// AFTER: Datalyr
import { Datalyr } from '@datalyr/react-native';
await Datalyr.trackPurchase(99.99, 'USD', 'product_id');
```

### From Adjust

```typescript
// BEFORE: Adjust
import { Adjust, AdjustEvent } from 'react-native-adjust';
const event = new AdjustEvent('abc123');
event.setRevenue(99.99, 'USD');
Adjust.trackEvent(event);

// AFTER: Datalyr
import { Datalyr } from '@datalyr/react-native';
await Datalyr.trackPurchase(99.99, 'USD');
```

### Event Mapping

| AppsFlyer | Adjust | Datalyr |
|-----------|--------|---------|
| `af_purchase` | `PURCHASE` | `trackPurchase()` |
| `af_add_to_cart` | `ADD_TO_CART` | `trackAddToCart()` |
| `af_initiated_checkout` | `INITIATE_CHECKOUT` | `trackInitiateCheckout()` |
| `af_complete_registration` | `COMPLETE_REGISTRATION` | `trackCompleteRegistration()` |
| `af_content_view` | `VIEW_CONTENT` | `trackViewContent()` |
| `af_subscribe` | `SUBSCRIBE` | `trackSubscription()` |

### Migration Checklist

- [ ] Remove old SDK: `npm uninstall react-native-appsflyer`
- [ ] Install Datalyr: `npm install @datalyr/react-native`
- [ ] Run `cd ios && pod install`
- [ ] Replace initialization and event tracking code
- [ ] Verify events in Datalyr dashboard

---

## Enhanced App Campaigns

Run mobile app ads through web campaigns (Meta Sales, TikTok Traffic, Google Ads) that redirect users to the app store through your own domain. This bypasses SKAN restrictions, ATT requirements, and adset limits — ad platforms treat these as regular web campaigns.

### How It Works

1. User clicks your ad → lands on a page on your domain with the Datalyr web SDK (`dl.js`)
2. SDK captures attribution (fbclid, ttclid, gclid, UTMs, ad cookies like `_fbp`/`_fbc`/`_ttp`)
3. User redirects to app store (via button click or auto-redirect)
4. User installs app → mobile SDK matches via Play Store referrer (Android, ~95%) or IP matching (iOS, ~90%+)
5. In-app events fire → conversions sent to Meta/TikTok/Google server-side via postbacks

### Setup

**1. Create a tracking link** in the Datalyr dashboard: Track → Create Link → App Link. Enter your prelander page URL and app store URLs.

**2. Host a page on your domain** with one of these options:

#### Option A: Prelander (Recommended)

A real landing page with a download button. Better ad platform compliance, higher intent.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Download Your App</title>
  <script src="https://cdn.datalyr.com/dl.js" data-workspace="YOUR_WORKSPACE_ID"></script>
</head>
<body>
  <h1>Download Our App</h1>
  <button id="ios-download">Download for iOS</button>
  <button id="android-download">Download for Android</button>

  <script>
    document.getElementById('ios-download').addEventListener('click', function() {
      Datalyr.trackAppDownloadClick({
        targetPlatform: 'ios',
        appStoreUrl: 'https://apps.apple.com/app/idXXXXXXXXXX'
      });
    });
    document.getElementById('android-download').addEventListener('click', function() {
      Datalyr.trackAppDownloadClick({
        targetPlatform: 'android',
        appStoreUrl: 'https://play.google.com/store/apps/details?id=com.example.app'
      });
    });
  </script>
</body>
</html>
```

#### Option B: Redirect Page

Instant redirect — no visible content, user goes straight to app store.

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.datalyr.com/dl.js" data-workspace="YOUR_WORKSPACE_ID"></script>
  <script>
    window.addEventListener('DOMContentLoaded', function() {
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

**3. Set up your ad campaign:**

- **Meta Ads**: Campaign objective → Sales, conversion location → Website, placements → Mobile only. Paste your page URL as the Website URL. No SKAN, no ATT, no adset limits.
- **TikTok Ads**: Campaign objective → Website Conversions, paste your page URL as destination. Select your TikTok Pixel from Datalyr.
- **Google Ads**: Performance Max or Search campaign. Use your page URL as the landing page.

Add UTM parameters to the URL so attribution flows through:
- Meta: `?utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}`
- TikTok: `?utm_source=tiktok&utm_medium=cpc&utm_campaign=__CAMPAIGN_NAME__&utm_content=__AID_NAME__&utm_term=__CID_NAME__`
- Google: `?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}`

### Important

- The page **must load JavaScript**. Server-side redirects (301/302, nginx, Cloudflare Page Rules) will NOT work.
- Host on your own domain — do not use `datalyr.com` or shared domains.
- The redirect page adds ~300-500ms for the SDK to load. Prelander has no latency since the user clicks a button.

---

## Third-Party Integrations

### Superwall

Pass Datalyr attribution data to Superwall to personalize paywalls by ad source, campaign, ad set, and keyword.

```typescript
import { Datalyr } from '@datalyr/react-native';
import Superwall from '@superwall/react-native-superwall';

// After both SDKs are initialized
Superwall.setUserAttributes(Datalyr.getSuperwallAttributes());

// Your placements will now have attribution data available as filters
Superwall.register({ placement: 'onboarding_paywall' });
```

Call after `Datalyr.initialize()` completes. If using ATT on iOS, call again after the user responds to the ATT prompt to include the IDFA.

### RevenueCat

Pass Datalyr attribution data to RevenueCat for revenue attribution and offering targeting.

```typescript
import { Datalyr } from '@datalyr/react-native';
import Purchases from 'react-native-purchases';

// After both SDKs are configured
Purchases.setAttributes(Datalyr.getRevenueCatAttributes());
```

Call after configuring the Purchases SDK and before the first purchase. If using ATT, call again after permission is granted to include IDFA.

> Datalyr also receives Superwall and RevenueCat events via server-side webhooks for analytics. The SDK methods and webhook integration are independent — you can use one or both.

---

## Troubleshooting

### Events Not Appearing

**1. Check SDK Status**
```typescript
const status = Datalyr.getStatus();
console.log('Initialized:', status.initialized);
console.log('Queue size:', status.queueStats.queueSize);
console.log('Online:', status.queueStats.isOnline);
```

**2. Enable Debug Mode**
```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  debug: true,
});
```

**3. Force Flush**
```typescript
await Datalyr.flush();
```

**4. Verify API Key** - Should start with `dk_`

### iOS Build Errors

```bash
cd ios
pod deintegrate
pod cache clean --all
pod install
```

**Clean Reset**
```bash
rm -rf node_modules ios/Pods ios/Podfile.lock
npm install && cd ios && pod install
```

### Android Build Errors

```bash
cd android && ./gradlew clean
npx react-native run-android
```

### SKAdNetwork Not Updating

1. iOS 14.0+ required (16.1+ for SKAN 4.0)
2. Set `skadTemplate` in config
3. Use `trackWithSKAdNetwork()` instead of `track()`

### Attribution Not Captured

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  enableAttribution: true,
});

// Check data
const attribution = Datalyr.getAttributionData();
```

### App Tracking Transparency (iOS 14.5+)

```typescript
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';

const { status } = await requestTrackingPermissionsAsync();
await Datalyr.updateTrackingAuthorization(status === 'granted');
```

### Debug Logging

Look for `[Datalyr]` prefixed messages in console.

---

## License

MIT
