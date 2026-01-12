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
  - [Deferred Deep Links](#deferred-deep-links)
- [Event Queue](#event-queue)
- [Auto Events](#auto-events)
- [SKAdNetwork](#skadnetwork)
- [Platform Integrations](#platform-integrations)
  - [Meta](#meta-facebook)
  - [TikTok](#tiktok)
  - [Apple Search Ads](#apple-search-ads)
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

This installs the SDK with bundled Meta and TikTok native SDKs.

Add to `ios/YourApp/Info.plist`:

```xml
<!-- Meta SDK -->
<key>FacebookAppID</key>
<string>YOUR_FACEBOOK_APP_ID</string>
<key>FacebookClientToken</key>
<string>YOUR_CLIENT_TOKEN</string>
<key>FacebookDisplayName</key>
<string>Your App Name</string>

<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>fbYOUR_FACEBOOK_APP_ID</string>
    </array>
  </dict>
</array>

<!-- TikTok SDK -->
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>tiktok</string>
  <string>snssdk1180</string>
  <string>snssdk1233</string>
</array>
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

  // Platform SDKs
  meta?: MetaConfig,
  tiktok?: TikTokConfig,
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

Standard e-commerce events that also forward to Meta and TikTok:

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
- User data is forwarded to Meta/TikTok for Advanced Matching

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

### Deferred Deep Links

Capture attribution from App Store installs (iOS):

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  meta: {
    appId: '1234567890',
    enableDeferredDeepLink: true,
  },
});

// Check for deferred attribution
const deferred = Datalyr.getDeferredAttributionData();
if (deferred) {
  console.log(deferred.fbclid);      // Facebook click ID
  console.log(deferred.campaignId);  // Campaign ID
}
```

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

Bundled Meta and TikTok SDKs for iOS. No extra npm packages needed.

### Meta (Facebook)

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  meta: {
    appId: '1234567890',
    clientToken: 'abc123',
    enableDeferredDeepLink: true,
    enableAppEvents: true,
  },
});
```

### TikTok

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  tiktok: {
    appId: 'your_app_id',
    tiktokAppId: '7123456789',
    enableAppEvents: true,
  },
});
```

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
// { meta: true, tiktok: true, appleSearchAds: true }
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

### Meta SDK Not Working

Verify Info.plist:
```xml
<key>FacebookAppID</key>
<string>YOUR_APP_ID</string>
<key>FacebookClientToken</key>
<string>YOUR_CLIENT_TOKEN</string>
```

Check status: `Datalyr.getPlatformIntegrationStatus()`

### TikTok SDK Not Working

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  tiktok: {
    appId: 'your_app_id',
    tiktokAppId: '7123456789012345',
  },
});
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
