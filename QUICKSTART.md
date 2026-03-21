# Datalyr -- Complete React Native & Expo Setup Guide

> Everything you need to set up mobile attribution, event tracking, and web-to-app campaigns in your React Native or Expo app.

**Links:** [Full Docs](https://docs.datalyr.com) | [React Native SDK Reference](https://docs.datalyr.com/sdks/mobile#react-native-sdk) | [npm](https://www.npmjs.com/package/@datalyr/react-native)

---

## Step 1: Create Your Datalyr Account

1. Sign up at [app.datalyr.com](https://app.datalyr.com)
2. Go to **Settings > API Keys**
3. Create or copy your API Key (starts with `dk_`)

That's all you need. Only the API key is required -- `workspaceId` is no longer needed.

---

## Step 2: Install the Datalyr SDK

### Installation

```bash
npm install @datalyr/react-native
```

**iOS setup:**
```bash
cd ios && pod install && cd ..
```

**Android setup:**
No additional setup required.

**Expo:**
Works out of the box. No additional plugins or `eas.json` changes needed. Works with both Expo Go (development) and EAS builds (production).

### Initialize the SDK

**Standard React Native (App.tsx):**
```javascript
import React, { useEffect } from 'react';
import { Datalyr } from '@datalyr/react-native';

function App() {
  useEffect(() => {
    Datalyr.initialize({
      apiKey: 'dk_your_api_key',
      debug: true, // Set false in production
      enableAutoEvents: true,
      enableAttribution: true,
      enableWebToAppAttribution: true,
    });
  }, []);

  return (
    // Your app
  );
}
```

**Expo:**
```javascript
import { Datalyr } from '@datalyr/react-native/expo';

// Same initialization as above
```

### Full Configuration Options

```javascript
await Datalyr.initialize({
  // Required
  apiKey: 'dk_your_api_key',              // Get from Settings > API Keys

  // Optional: workspace
  workspaceId: undefined,                  // Only for multi-workspace setups

  // Debugging
  debug: false,                            // Default: false. Console logging.

  // Network
  endpoint: 'https://ingest.datalyr.com/track', // Default API endpoint
  useServerTracking: true,                 // Default: true. Server-side tracking.
  maxRetries: 3,                           // Default: 3. Retry failed requests.
  retryDelay: 1000,                        // Default: 1000ms between retries.
  timeout: 15000,                          // Default: 15000ms request timeout.

  // Features
  enableAutoEvents: true,                  // Default: true. Track app lifecycle.
  enableAttribution: true,                 // Default: true. Capture attribution.
  enableWebToAppAttribution: true,         // Default: true. Web-to-app matching.

  // Event queue
  batchSize: 10,                           // Default: 10. Events per batch.
  flushInterval: 30000,                    // Default: 30000ms between flushes.
  maxQueueSize: 100,                       // Default: 100. Max queued events.

  // Auto events fine control
  autoEventConfig: {
    trackSessions: true,                   // Default: true. session_start/end.
    trackScreenViews: true,                // Default: true. Screen view events.
    trackAppUpdates: true,                 // Default: true. app_update events.
    trackPerformance: false,               // Default: false. Performance metrics.
    sessionTimeoutMs: 1800000,             // Default: 1800000 (30 min).
  },

  // iOS SKAdNetwork
  skadTemplate: 'subscription',            // Options: 'ecommerce', 'gaming', 'subscription'
});
```

### What Gets Tracked Automatically

When `enableAutoEvents` is `true` (default), these events fire without any code:

| Event | Trigger |
|---|---|
| `app_install` | First app open ever |
| `app_open` | App launches |
| `app_background` | App enters background |
| `app_foreground` | App returns from background |
| `app_update` | App version changes |
| `session_start` | New session begins |
| `session_end` | 30 min inactivity timeout |

### Android: Play Install Referrer

For deterministic web-to-app attribution on Android (~95% accuracy), add the Play Install Referrer library to `android/app/build.gradle`:

```groovy
dependencies {
    // ... other dependencies
    implementation 'com.android.installreferrer:installreferrer:2.2'
}
```

The SDK reads the install referrer automatically on first launch. No additional code required.

**Links:** [React Native SDK Docs](https://docs.datalyr.com/sdks/mobile#react-native-sdk) | [npm](https://www.npmjs.com/package/@datalyr/react-native)

---

## Step 3: Track Events & Identify Users

### 3a. Custom Events

```javascript
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

### 3b. Screen Views

**Manual:**
```javascript
await Datalyr.screen('Home');

await Datalyr.screen('Product Details', {
  product_id: 'SKU123',
  source: 'search',
});
```

**Automatic with React Navigation (v5+/v6+):**
```javascript
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
      {/* ...screens */}
    </NavigationContainer>
  );
}
```

**Automatic with Expo Router:**
```javascript
// app/_layout.tsx
import { useDatalyrScreenTracking } from '@datalyr/react-native/expo';
import { Stack } from 'expo-router';

export default function RootLayout() {
  useDatalyrScreenTracking();
  return <Stack />;
}
```

**Custom screen name mapping (Expo Router):**
```javascript
useDatalyrScreenTracking({
  // Map specific paths to friendly names
  screenNames: {
    '/onboarding/paywall': 'Paywall',
    '/(app)/chat': 'Chat',
  },

  // Transform all other pathnames
  transformPathname: (path) => path.replace(/\(.*?\)\//g, ''),

  // Skip tracking for certain paths
  shouldTrackPath: (path) => !path.startsWith('/modal'),
});
```

**Custom screen name mapping (React Navigation):**
```javascript
const screenTracking = datalyrScreenTracking(navigationRef, {
  // Clean up route names
  transformScreenName: (name) => name.replace('Screen', ''),

  // Skip certain screens
  shouldTrackScreen: (name) => !['Splash', 'Loading'].includes(name),

  // Extract route params as event properties
  extractProperties: (name, params) => ({
    product_id: params?.productId,
  }),
});
```

> **WARNING: Don't use both manual `screen()` calls AND automatic screen tracking for the same screens -- this creates duplicate events.**

### 3c. E-Commerce Events

```javascript
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

> **WARNING: If you use Superwall or RevenueCat, do NOT use `trackPurchase()`, `trackSubscription()`, or `trackRevenue()` for subscription revenue.** These fire client-side before payment is confirmed -- trials and failed payments will be counted as revenue. Use the webhook integration instead (Step 4). Only use these methods for one-time purchases when you handle billing directly.

### 3d. Identify Users

Call `identify()` after signup or login. **Include the user's email -- this is critical for iOS web-to-app attribution.** If IP matching fails (VPN, delayed install, network change), email is the fallback that connects the web visitor to the app user.

```javascript
await Datalyr.identify('user_123', {
  email: 'user@example.com',    // Critical for attribution
  name: 'John Doe',
  phone: '+1234567890',
  plan: 'premium',
  signup_date: '2025-09-29',
});
```

**When to call:**
- After signup
- After login
- After profile update (if email changes)

### 3e. Alias

Associate a new user ID with a previous one (e.g., after account merge):

```javascript
// Link new ID to the currently identified user
await Datalyr.alias('new_user_456');

// Or specify the previous ID explicitly
await Datalyr.alias('new_user_456', 'old_user_123');
```

### 3f. Logout / Reset

```javascript
await Datalyr.reset();
```

This clears the user ID, starts a new session, but keeps the anonymous ID (same device).

> **Always call `reset()` on logout.** If you don't, the next user's events will be attributed to the previous user.

### 3g. Anonymous ID

Every device gets a persistent anonymous ID on first launch:

```javascript
const anonymousId = Datalyr.getAnonymousId();
// Pass to your backend for server-side attribution
```

### 3h. Sessions

```javascript
// Get current session data
const session = Datalyr.getCurrentSession();

// End session manually
await Datalyr.endSession();
```

Sessions auto-expire after 30 minutes of inactivity (configurable via `autoEventConfig.sessionTimeoutMs`).

### 3i. Customer Journey

```javascript
import { datalyr } from '@datalyr/react-native';

// Summary: first/last touch, touchpoint count
const summary = datalyr.getJourneySummary();

// Full journey: all touchpoints in order
const journey = datalyr.getJourney();
```

**Links:** [Events Overview](https://docs.datalyr.com/understanding-data/events-overview) | [Identity Calls](https://docs.datalyr.com/understanding-data/identity-calls) | [Visitor Identification](https://docs.datalyr.com/understanding-data/visitor-identification)

---

## Step 4: Connect Your Payment Provider

> **The SDK tracks WHO your users are and WHERE they came from. Your payment provider tracks WHAT they paid. You need both for full attribution.** Revenue comes through server-side webhooks -- not the SDK.

### 4a. Superwall

**In Datalyr Dashboard:**
1. Go to **Settings > Integrations**
2. Click **Connect** next to Superwall
3. Enter your Superwall **Project ID**
4. Copy the generated **webhook URL**

**In Superwall Dashboard:**
1. Go to **Settings > Integrations > Webhooks**
2. Click **Add Webhook Endpoint**
3. Paste the Datalyr webhook URL
4. Select **All Events**
5. Click **Save**
6. Click **Copy Secret** on the webhook endpoint (the `whsec_...` value)
7. Go back to Datalyr and paste the signing secret

**In Your Code -- Pass Attribution to Superwall:**
```javascript
import { Datalyr } from '@datalyr/react-native';
import Superwall from '@superwall/react-native-superwall';

// After BOTH SDKs are initialized
const attrs = Datalyr.getSuperwallAttributes();
Superwall.setUserAttributes(attrs);
```

**Call this:**
- After both SDKs are initialized (on app launch)
- Again after `identify()` if user info changes
- Again after the user responds to the ATT prompt (to include IDFA)

**Returned attribute keys:**

| Key | Description |
|---|---|
| `datalyr_id` | Datalyr visitor ID |
| `media_source` | Acquisition source (from `utm_source`) |
| `campaign` | Campaign name |
| `adgroup` | Ad group / adset |
| `ad` | Ad identifier |
| `keyword` | Search keyword |
| `network` | Ad network name |
| `utm_source` | UTM source |
| `utm_medium` | UTM medium |
| `utm_campaign` | UTM campaign |
| `utm_term` | UTM term |
| `utm_content` | UTM content |
| `lyr` | Datalyr tracking link ID |
| `fbclid` | Meta click ID |
| `gclid` | Google click ID |
| `ttclid` | TikTok click ID |
| `idfa` | iOS Advertising ID (if ATT authorized) |
| `gaid` | Google Advertising ID (Android) |
| `att_status` | ATT status (0-3) |

Only non-empty values are included.

**Events tracked via Superwall webhook:**

| Superwall Event | Datalyr Event | Has Revenue |
|---|---|---|
| `initial_purchase` | `subscription_started` | Yes |
| `renewal` | `subscription_renewed` | Yes |
| `non_renewing_purchase` | `purchase` | Yes |
| `cancellation` | `subscription_cancelled` | No |
| `expiration` | `subscription_expired` | No |
| `billing_issue` | `billing_failed` | No |
| `uncancellation` | `subscription_reactivated` | No |
| `product_change` | `subscription_changed` | No |
| `subscription_paused` | `subscription_paused` | No |

### 4b. RevenueCat

**In Datalyr Dashboard:**
1. Go to **Settings > Integrations**
2. Click **Connect** next to RevenueCat
3. Enter your RevenueCat **Project ID**
4. Copy the generated **webhook URL**

**In RevenueCat Dashboard:**
1. Go to **Project Settings > Integrations > Webhooks**
2. Click **Add new configuration**
3. Name it "Datalyr"
4. Paste the Datalyr webhook URL
5. (Recommended) Set an **Authorization Header** value -- paste the same value in Datalyr
6. Select **Production** events
7. Click **Save**

**In Your Code -- Pass Attribution to RevenueCat:**
```javascript
import { Datalyr } from '@datalyr/react-native';
import Purchases from 'react-native-purchases';

// After BOTH SDKs are initialized
const attrs = Datalyr.getRevenueCatAttributes();
Purchases.setAttributes(attrs);
```

**Returned attribute keys (reserved `$`-prefixed):**

| Key | Description |
|---|---|
| `$datalyrId` | Datalyr visitor ID |
| `$mediaSource` | Acquisition source |
| `$campaign` | Campaign name |
| `$adGroup` | Ad group / adset |
| `$ad` | Ad identifier |
| `$keyword` | Search keyword |
| `$idfa` | iOS Advertising ID (if ATT authorized) |
| `$gpsAdId` | Google Advertising ID |
| `$attConsentStatus` | ATT consent status string |

**ATT status mapping for `$attConsentStatus`:**

| ATT Value | String |
|---|---|
| 0 | `notDetermined` |
| 1 | `restricted` |
| 2 | `denied` |
| 3 | `authorized` |

**Custom attributes (also returned):**

| Key | Description |
|---|---|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | UTM parameters |
| `lyr` | Datalyr tracking link ID |
| `fbclid`, `gclid`, `ttclid`, `wbraid`, `gbraid` | Ad click IDs |
| `network` | Ad network |
| `creative_id` | Creative ID |

**Events tracked via RevenueCat webhook:**

| RevenueCat Event | Datalyr Event | Has Revenue |
|---|---|---|
| `INITIAL_PURCHASE` | `subscription_started` | Yes |
| `RENEWAL` | `subscription_renewed` | Yes |
| `NON_RENEWING_PURCHASE` | `purchase` | Yes |
| `CANCELLATION` | `subscription_cancelled` | No |
| `UNCANCELLATION` | `subscription_reactivated` | No |
| `EXPIRATION` | `subscription_expired` | No |
| `BILLING_ISSUE` | `billing_failed` | No |
| `PRODUCT_CHANGE` | `subscription_changed` | No |
| `SUBSCRIPTION_PAUSED` | `subscription_paused` | No |
| `SUBSCRIPTION_EXTENDED` | `subscription_extended` | No |
| `TRANSFER` | `subscription_transferred` | No |
| `REFUND_REVERSED` | `refund_reversed` | Yes |

### 4c. No Payment Provider?

- Contact us at hello@datalyr.com and we'll help you get set up
- Or use `trackPurchase()` directly if you handle billing yourself (only after confirming a real charge, not on trial start)

**Links:** [Superwall Integration](https://docs.datalyr.com/integrations/superwall) | [RevenueCat Integration](https://docs.datalyr.com/integrations/revenuecat)

---

## Step 5: Install the Web SDK

**WHY:** The web SDK tracks users on your landing pages. When a user clicks an ad, lands on your page, then installs your app -- the web SDK captured the attribution data (click IDs, UTMs, IP) that the mobile SDK will match against. This is how web-to-app attribution works.

### npm Package (Recommended)

The npm package is the recommended approach -- it bundles into your own domain for better privacy, avoids ad blockers, and gives you full TypeScript support.

```bash
npm install @datalyr/web
```

```javascript
import datalyr from '@datalyr/web';

datalyr.init({
  workspaceId: 'YOUR_WORKSPACE_ID'
});
```

### Script Tag (Alternative)

For sites without a build system, add to your landing page `<head>`:
```html
<script defer src="https://track.datalyr.com/dl.js"
  data-workspace-id="YOUR_WORKSPACE_ID">
</script>
```

Get your Workspace ID from **Settings > General** in the Datalyr dashboard.

### What the Web SDK Captures Automatically

- Page views
- UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`)
- Ad click IDs (`fbclid`, `gclid`, `ttclid`, `twclid`, `li_click_id`, `msclkid`)
- Referrer data
- Visitor ID (stored in cookie)
- IP address and user agent

**Links:** [Web SDK Docs](https://docs.datalyr.com/sdks/web)

---

## Step 6: Connect Your Ad Platforms

Datalyr sends conversions to ad platforms **server-side** via their APIs (Meta CAPI, Google Ads API, TikTok Events API). **You do NOT need the Facebook SDK, TikTok SDK, or Google SDK in your app.**

### Meta (Facebook/Instagram)

1. In Datalyr, go to **Settings > Connections**
2. Click **Connect Meta**
3. Authorize your Meta Business account
4. Select your **Meta Pixel**

### TikTok

1. In Datalyr, go to **Settings > Connections**
2. Click **Connect TikTok**
3. Authorize your TikTok Ads account
4. Select your **TikTok Pixel**

### Google Ads

1. In Datalyr, go to **Settings > Connections**
2. Click **Connect Google**
3. Authorize your Google Ads account
4. Select your **conversion actions**

### Apple Search Ads

Apple Search Ads attribution is handled automatically by the Datalyr SDK. No dashboard setup required — the SDK uses Apple's AdServices framework to fetch attribution data on first launch (iOS 14.3+).

**What happens automatically:**
- On first app launch, the SDK checks if the install came from an Apple Search Ads campaign
- If attributed, the data is included in all events with the `asa_` prefix
- No additional code or configuration needed

**Access the data in your code:**
```javascript
const asaAttribution = Datalyr.getAppleSearchAdsAttribution();

if (asaAttribution?.attribution) {
  console.log(asaAttribution.campaignId);    // Campaign ID
  console.log(asaAttribution.campaignName);  // Campaign name
  console.log(asaAttribution.adGroupId);     // Ad group ID
  console.log(asaAttribution.adGroupName);   // Ad group name
  console.log(asaAttribution.keyword);       // Search keyword that triggered the ad
  console.log(asaAttribution.keywordId);     // Keyword ID
  console.log(asaAttribution.clickDate);     // Click date
  console.log(asaAttribution.conversionType); // "Download" or "Redownload"
  console.log(asaAttribution.orgId);         // Organization ID
  console.log(asaAttribution.orgName);       // Organization name
  console.log(asaAttribution.region);        // Region/country code
}
```

**Fields automatically added to all events:**

| Event Field | Description |
|---|---|
| `asa_campaign_id` | Campaign ID |
| `asa_campaign_name` | Campaign name |
| `asa_ad_group_id` | Ad group ID |
| `asa_ad_group_name` | Ad group name |
| `asa_keyword_id` | Keyword ID |
| `asa_keyword` | Search keyword |
| `asa_org_id` | Organization ID |
| `asa_org_name` | Organization name |
| `asa_click_date` | Date of the ad click |
| `asa_conversion_type` | Conversion type |

These fields are included automatically — you don't need to pass them manually. They flow through to your conversion rules and postbacks so your Apple Search Ads campaigns get proper attribution.

> **Note:** Apple Search Ads attribution is iOS only. On Android, this returns `null`.

**Links:** [Meta Ads](https://docs.datalyr.com/integrations/meta-ads) | [TikTok Ads](https://docs.datalyr.com/integrations/tiktok-ads) | [Google Ads](https://docs.datalyr.com/integrations/google-ads)

---

## Step 7: Set Up Conversion Rules

Conversion rules tell Datalyr which in-app events to send back to which ad platforms as conversions.

**In Datalyr Dashboard:**
1. Go to **Settings > Conversion Rules**
2. Click **Add Rule**
3. Select your **trigger event** (e.g., `subscription_started`)
4. Choose the **target platform** (Meta, Google, TikTok)
5. Select the **platform event name** (e.g., `Purchase` for Meta)
6. Set the **value**: Dynamic (from event data) or Static (fixed amount)
7. Click **Save** -- it's active immediately

### Common Rules for Mobile Apps

| Datalyr Event | Meta Event | Google Event | TikTok Event |
|---|---|---|---|
| `subscription_started` | `Purchase` | `purchase` | `CompletePayment` |
| `purchase` | `Purchase` | `purchase` | `CompletePayment` |
| `signup` | `Lead` | `sign_up` | `Registration` |
| `app_download_click` | `Lead` | `page_view` | `ClickButton` |

You can create multiple rules for the same event to send to multiple platforms.

**Links:** [Conversion Rules](https://docs.datalyr.com/integrations/conversion-rules)

---

## Step 8: Set Up App Campaigns (Web-to-App)

This is the core of how Datalyr works for mobile apps. Run your mobile app ads as **web campaigns** (Meta Sales, TikTok Traffic, Google Ads) through your own domain. Ad platforms treat these as regular web campaigns -- **no SKAN restrictions, no ATT requirements, no adset limits.**

### How It Works

1. **User clicks your ad** -- Lands on a page on YOUR domain with the Datalyr web SDK
2. **SDK captures attribution** -- Click IDs (fbclid, ttclid, gclid), UTMs, ad cookies (_fbp, _fbc, _ttp), visitor ID, IP address
3. **User redirects to app store** -- Either via a button click (prelander) or automatically (redirect page)
4. **User installs and opens app** -- Mobile SDK matches the user:
   - **Android**: Play Store referrer (deterministic, ~95% accuracy)
   - **iOS**: IP matching against recent web events (~90%+ for immediate installs), email fallback on `identify()`
5. **In-app events fire** -- Conversions are sent to Meta/TikTok/Google server-side via Datalyr postbacks

### Why This Works

Ad platforms apply mobile-specific restrictions (SKAN, ATT, limited adsets) only when you select "App Installs" as the campaign objective. When you use a web objective like "Sales" or "Traffic", the ad platform treats it as a regular website campaign. Your landing page is a real web page -- the Datalyr web SDK captures all attribution, then the user continues to the app store.

### Prerequisites

Before setting up App Campaigns, make sure you have:

- [ ] Datalyr web SDK installed on your domain (Step 5)
- [ ] Datalyr mobile SDK installed in your app (Step 2)
- [ ] Conversion rules configured (Step 7)
- [ ] A domain you control for hosting the landing page
- [ ] At least one ad platform connected (Step 6)

### 8a. Create an App Link

1. In Datalyr dashboard, go to **Track > Create Link**
2. Select **App Link**
3. Enter your page URL (e.g., `https://yourapp.com/download`)
4. Give the link a name (e.g., "Meta Spring Campaign")
5. Optionally add a tracking ID (`lyr`) for segmentation
6. Add UTM parameters if needed
7. Copy the generated tracking URL

Use this URL in your ad campaigns. The app store URL goes in your page code (in `trackAppDownloadClick()`), not in the dashboard.

### 8b. Set Up Your Landing Page

Host one of these page types on your domain (e.g., `yourapp.com/download`).

#### Option A: Prelander (Recommended)

A real landing page with content and a download button. Better for:
- Ad platform compliance (real page with content)
- Higher conversion intent (user actively clicks download)
- Email capture for fallback attribution on iOS
- Lower risk of being flagged for thin content

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
  <!-- Add your own design, content, and styling -->
  <h1>Download Our App</h1>
  <p>Get the best experience on mobile.</p>

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

Replace `YOUR_WORKSPACE_ID` and the app store URLs with your actual values.

**What `trackAppDownloadClick()` does:**
1. Fires an `app_download_click` event with all captured attribution data
2. Stores the visitor's click IDs, UTM parameters, IP address, and user agent
3. Redirects the user to the specified app store URL
4. **Android**: Appends the Datalyr referrer parameter to the Play Store URL for deterministic matching

#### Option B: Redirect Page

Automatic redirect -- no visible content, user goes straight to app store:

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://track.datalyr.com/dl.js" data-workspace-id="YOUR_WORKSPACE_ID"></script>
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

> **WARNING:** Meta may flag redirect pages with no visible content as low-quality landing pages or cloaking. Use the prelander approach if compliance is a concern.

> **WARNING:** JavaScript is required. Server-side redirects (301/302), nginx redirects, Cloudflare Page Rules, and DNS redirects do NOT work. The Datalyr web SDK must execute in the browser.

### 8c. Configure Ad Campaigns

#### Meta (Facebook/Instagram)

1. In Meta Ads Manager, click **+ Create**
2. Campaign objective: **Sales**
3. At ad set level, Conversion section: select **Website** as conversion location
4. Select your **dataset** (Meta Pixel connected in Datalyr Settings > Connections)
5. Select the **conversion event** to optimize for (must match your conversion rule, e.g., `purchase`)
6. Under Placements: **Mobile only**, correct OS
7. At ad level: paste your landing page URL into **Website URL**
8. Add UTM parameters:
```
?utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}
```
9. Launch

No SKAN restrictions. No ATT prompt required. No adset limits.

#### TikTok

1. Campaign objective: **Website Conversions** or **Traffic**
2. Paste landing page URL as **destination URL**
3. Select the **TikTok Pixel** connected in Datalyr
4. Select **conversion event** (must match conversion rule)
5. Target **mobile devices**, correct OS
6. Add UTM parameters:
```
?utm_source=tiktok&utm_medium=cpc&utm_campaign=__CAMPAIGN_NAME__&utm_content=__AID_NAME__&utm_term=__CID_NAME__
```
7. Launch

#### Google Ads

1. Campaign type: **Performance Max** or **Search**
2. Use landing page URL as **landing page**
3. Select **conversion action** from Datalyr
4. Add UTM parameters:
```
?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}
```
5. Launch

### 8d. How Attribution Works

**Android (Deterministic, ~95% accuracy):**
1. `trackAppDownloadClick()` appends a referrer parameter to the Play Store URL
2. Referrer contains visitor ID + attribution data
3. After install, mobile SDK reads Play Store referrer via Play Install Referrer API
4. Automatic match using referrer data

Requires: `implementation 'com.android.installreferrer:installreferrer:2.2'` in `android/app/build.gradle`

**iOS (Probabilistic, ~90%+ for immediate installs):**
1. Web SDK records visitor's IP, user agent, and all attribution when `trackAppDownloadClick()` fires
2. After install, mobile SDK sends device's IP address
3. Datalyr matches mobile IP against recent `app_download_click` events within 24 hours
4. If match found, app user is linked to web visitor

**iOS Email Fallback (for delayed installs, VPN changes):**
1. If IP matching fails (user installs later, switches networks, uses VPN)
2. When user signs up/logs in, your app calls `identify()` with the user's email
3. Datalyr matches email against previously identified web visitors
4. If match found, app user is linked to original web visitor

**This is why calling `identify()` with email is critical.** Without it, if IP matching fails, attribution is lost.

### 8e. Important Notes

- **Host on YOUR domain** -- not shared domains or URL shorteners
- **JavaScript required** -- server-side redirects don't work (dl.js must run in browser)
- **Redirect page latency** -- adds ~100-200ms for SDK to load
- **Prelander is safer** for ad platform compliance (especially Meta)
- **Target mobile-only** in ad campaigns -- desktop users can't install mobile apps
- **Add terms & privacy links** to prelander for Meta compliance

**Links:** [App Campaigns](https://docs.datalyr.com/features/app-campaigns) | [Track Links](https://docs.datalyr.com/features/track-links)

---

## Step 9: App Tracking Transparency (iOS)

ATT is **not required** for web-to-app campaigns (that's the whole point). But if the user grants permission, it improves match quality by providing IDFA.

```javascript
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';

// Request after onboarding, not on first launch
const { status } = await requestTrackingPermissionsAsync();
await Datalyr.updateTrackingAuthorization(status === 'granted');

// After ATT response, re-pass attributes to include IDFA
const attrs = Datalyr.getSuperwallAttributes(); // or getRevenueCatAttributes()
Superwall.setUserAttributes(attrs);
```

---

## Step 10: SKAdNetwork (iOS, Optional)

SKAdNetwork is an optional iOS 14+ feature for conversion value tracking. Not needed if you're using web-to-app campaigns with Superwall/RevenueCat webhooks.

```javascript
// Initialize with template
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  skadTemplate: 'subscription', // or 'ecommerce', 'gaming'
});

// Track with automatic SKAN encoding
await Datalyr.trackWithSKAdNetwork('purchase', {
  value: 99.99,
  currency: 'USD',
});

// Test conversion value before production
const value = Datalyr.getConversionValue('purchase', { value: 49.99 });
console.log('Conversion value:', value); // 0-63 or null
```

**Templates:**
- `ecommerce` -- purchase events, revenue ranges
- `gaming` -- level completion, IAP, retention
- `subscription` -- trial starts, conversions, renewals

---

## Step 11: Verify Everything Works

### Check SDK Events

With `debug: true`, you should see console logs like:
```
[Datalyr] SDK initialized
[Datalyr] Event tracked: app_install
[Datalyr] Event tracked: session_start
[Datalyr] Flushing 2 events
```

Check SDK status:
```javascript
const status = Datalyr.getStatus();
console.log('Initialized:', status.initialized);
console.log('Visitor ID:', status.visitorId);
console.log('Queue size:', status.queueStats.queueSize);
console.log('Online:', status.queueStats.isOnline);
```

Force flush events:
```javascript
await Datalyr.flush();
```

### Check Webhook Events

1. Make a test purchase (Sandbox/TestFlight)
2. In Datalyr dashboard, go to **Event Stream**
3. Filter by source (`superwall` or `revenuecat`)
4. You should see the event within seconds
5. In Superwall/RevenueCat webhook dashboard, check for `200` response

### Check Attribution

```javascript
const attribution = Datalyr.getAttributionData();
console.log('Source:', attribution.utm_source);
console.log('Campaign:', attribution.utm_campaign);
console.log('Click ID:', attribution.fbclid || attribution.gclid || attribution.ttclid);

const deferred = Datalyr.getDeferredAttributionData();
if (deferred) {
  console.log('Deferred source:', deferred.source);
  console.log('Deferred URL:', deferred.url);
}
```

### Check Postbacks

1. In Datalyr dashboard, check postback delivery status in **Event Stream**
2. Verify events appear in your ad platform:
   - **Meta**: Events Manager > Data Sources > Your Pixel > Event Activity
   - **Google**: Google Ads > Tools > Conversions
   - **TikTok**: TikTok Ads Manager > Events > Event History

> **Note:** Test mode conversions don't appear in ad platform reports but are visible in their event testing tools.

**Links:** [Tracking Not Working](https://docs.datalyr.com/troubleshooting/tracking-not-working) | [Missing Conversions](https://docs.datalyr.com/troubleshooting/missing-conversions) | [Postback Debugging](https://docs.datalyr.com/troubleshooting/postback-debugging)

---

## Best Practices

1. **Only use SDK for behavioral events if using Superwall/RevenueCat** -- `trackPurchase()` fires before payment is confirmed, counting trials and failed payments as revenue. Use webhooks for subscription revenue.

2. **Always pass attributes to your payment provider after both SDKs init** -- This links ad data to revenue. Without it, conversions aren't attributed to campaigns.

3. **Call `identify()` with email as early as possible** -- Critical for iOS web-to-app fallback attribution. Without email, IP-only matching degrades over time.

4. **Use prelander, not redirect, for App Campaigns** -- Ad platforms (especially Meta) flag redirect pages as cloaking/low-quality.

5. **Initialize SDK early** -- In App.tsx `useEffect`, before any other tracking calls. Android Play referrer must be read on first launch.

6. **Set `debug: false` in production** -- Debug mode logs everything to console.

7. **Call `flush()` before critical operations** -- After purchase events, before logout. Ensures events aren't lost if app crashes.

8. **Don't track the same event client AND server** -- Creates duplicates. Don't call `trackPurchase()` AND have webhooks send the same purchase event.

9. **Don't use both manual AND automatic screen tracking** -- Pick one. Using both creates duplicate pageview events.

10. **Call `getSuperwallAttributes()` / `getRevenueCatAttributes()` again after ATT prompt** -- Includes IDFA if user authorized.

11. **Add Play Install Referrer library on Android** -- Without it, Android web-to-app attribution falls back to less accurate methods.

---

## Common Mistakes

| Mistake | What Goes Wrong | Fix |
|---|---|---|
| Using `trackPurchase()` with Superwall/RevenueCat | Counts trials and failed payments as revenue | Use webhooks only for subscription revenue |
| Not calling `identify()` with email | iOS web-to-app attribution fails (no fallback) | Always identify with email after signup/login |
| Not passing attributes to Superwall/RevenueCat | Revenue events not attributed to campaigns | Call `getSuperwallAttributes()`/`getRevenueCatAttributes()` after SDK init |
| Server-side redirects for landing pages | Web SDK never loads, attribution data lost | Must use JavaScript-based page |
| Duplicate screen tracking | Manual `screen()` + automatic tracking | Use ONE method only |
| Wrong API key format | Auth errors | Must start with `dk_`, from Settings > API Keys |
| Not setting up conversion rules | Events tracked but never sent to ad platforms | Dashboard > Settings > Conversion Rules |
| Forgetting `reset()` on logout | Next user's events attributed to previous user | Always call `reset()` on logout |
| Missing Play Install Referrer (Android) | Android web-to-app attribution fails | Add `installreferrer:2.2` to build.gradle |
| Initializing SDK multiple times | Race conditions, double events | Initialize ONCE in App.tsx useEffect |
| Calling `getAttributionData()` before SDK resolves | Returns empty | Wait for initialization, or check after identify() |

---

## FAQ

### Setup & SDKs

**Do I need the Facebook/TikTok/Google SDK in my app?**
No. Datalyr handles all conversions server-side via postbacks. No ad platform SDKs needed in your app.

**Do I need to track purchases in the SDK?**
No, if using Superwall/RevenueCat. Revenue is tracked via webhooks. Only use `trackPurchase()` if you handle billing yourself.

**Can I use the same webhook URL for iOS and Android?**
Yes.

**Does Datalyr replace AppsFlyer/Adjust?**
Yes -- install attribution, SKAN conversion values, and campaign-to-revenue matching without per-MAU pricing.

**Can I use both Superwall and RevenueCat?**
Yes, each gets its own webhook URL.

**Does tracking work offline?**
Yes. Events queue locally (up to 100 by default) and send when connectivity returns.

**Does it work with Expo?**
Yes. Works with Expo Go, EAS builds, managed workflow, and bare workflow. Import from `@datalyr/react-native/expo` for Expo-specific helpers.

### Attribution

**Do I need IDFA/ATT?**
Optional. Improves match quality but not required. Web-to-app campaigns work without it.

**What's the attribution window?**
30 days default in Datalyr. Platform-specific: Meta 7-day click / 1-day view, Google 90-day click / 1-day view, TikTok 28-day click / 1-day view.

**How accurate is web-to-app attribution?**
Android ~95% (deterministic via Play referrer). iOS ~90%+ for same-session installs (IP matching), higher with email fallback via `identify()`.

**Why do I need to call `identify()` with email?**
It's the iOS fallback. If IP matching fails (VPN, delayed install, network change), email matching connects the web visitor to the app user.

**Do I need the Play Install Referrer library for Android?**
Yes, for deterministic attribution. Add `implementation 'com.android.installreferrer:installreferrer:2.2'` to `android/app/build.gradle`.

### Revenue & Conversions

**How do I see my attribution data?**
Dashboard > Attribution Reports.

**Why aren't my conversions showing in Meta/Google/TikTok?**
Check: conversion rules exist, ad platform connected, user has valid click ID (fbclid/gclid/ttclid), event within attribution window.

**What events does the webhook track?**
Purchases, renewals, cancellations, expirations, billing issues, refunds, trial conversions, product changes.

### Technical

**What gets tracked automatically?**
`app_install`, `app_open`, `app_background`, `app_foreground`, `app_update`, `session_start`, `session_end`.

**Will Datalyr slow down my app?**
No. Events batch (default 10 events or 30 seconds) and queue offline. Minimal footprint.

**Is SKAdNetwork required?**
No. Optional iOS 14+ feature. Not needed if using web-to-app campaigns with Superwall/RevenueCat webhooks.

---

## Troubleshooting

### Events Not Appearing

1. Check API key is correct (starts with `dk_`)
2. Enable `debug: true` -- look for `[Datalyr]` console logs
3. Check `getStatus()` -- is `initialized` true? Is queue growing?
4. Call `flush()` to force send
5. Check network -- are requests hitting `ingest.datalyr.com`?
6. Check Dashboard > **Event Stream**

### Attribution Not Matching (Web-to-App)

1. Is web SDK loading on your landing page? Check browser console for `dl.js`
2. Is `trackAppDownloadClick()` firing before the redirect?
3. Is mobile SDK initialized in your app?
4. Did user install from the same IP? (check for VPN/network change)
5. Is `identify()` called with email? (iOS fallback)
6. Is attribution within window? (24hr for IP, 30d for email)
7. **Android**: Is Play Install Referrer library in build.gradle?

### Postbacks Not Sending

1. Do conversion rules exist for the event? (case-sensitive names!)
2. Is ad platform connected in Settings > Connections?
3. Does the event have a valid click ID (fbclid/gclid/ttclid)?
4. Check Dashboard for postback delivery status
5. Check ad platform for received conversions

### Build Errors (iOS)

```bash
cd ios
pod deintegrate
pod cache clean --all
pod install
```

### Build Errors (Android)

```bash
cd android && ./gradlew clean
npx react-native run-android
```

### Full Clean Reset

```bash
rm -rf node_modules ios/Pods ios/Podfile.lock
npm install && cd ios && pod install
```

### SKAdNetwork Not Working

- iOS 14.0+ required (16.1+ for SKAN 4.0)
- Is `skadTemplate` set in config?
- Using `trackWithSKAdNetwork()` instead of `track()`?

**Links:** [Tracking Not Working](https://docs.datalyr.com/troubleshooting/tracking-not-working) | [Missing Conversions](https://docs.datalyr.com/troubleshooting/missing-conversions) | [Postback Debugging](https://docs.datalyr.com/troubleshooting/postback-debugging) | [Data Discrepancies](https://docs.datalyr.com/troubleshooting/data-discrepancies) | [Integration Errors](https://docs.datalyr.com/troubleshooting/integration-errors)

---

## API Reference

### Initialization
| Method | Description |
|---|---|
| `Datalyr.initialize(config)` | Initialize the SDK. Must call before anything else. |

### Event Tracking
| Method | Description |
|---|---|
| `Datalyr.track(eventName, properties?)` | Track a custom event |
| `Datalyr.screen(screenName, properties?)` | Track a screen view |
| `Datalyr.trackPurchase(value, currency?, productId?)` | Track a purchase |
| `Datalyr.trackSubscription(value, currency?, plan?)` | Track a subscription |
| `Datalyr.trackRevenue(eventName, properties?)` | Track a revenue event |
| `Datalyr.trackWithSKAdNetwork(event, properties?)` | Track with SKAN conversion encoding |
| `Datalyr.trackViewContent(id?, name?, type?, value?, currency?)` | Track content view |
| `Datalyr.trackAddToCart(value, currency?, id?, name?)` | Track add-to-cart |
| `Datalyr.trackInitiateCheckout(value, currency?, numItems?, ids?)` | Track checkout start |
| `Datalyr.trackCompleteRegistration(method?)` | Track registration |
| `Datalyr.trackSearch(query, resultIds?)` | Track a search |
| `Datalyr.trackLead(value?, currency?)` | Track a lead |
| `Datalyr.trackAddPaymentInfo(success?)` | Track payment info added |
| `Datalyr.trackAppUpdate(previousVersion, currentVersion)` | Track app update |

### User Identity
| Method | Description |
|---|---|
| `Datalyr.identify(userId, properties?)` | Identify a user |
| `Datalyr.alias(newUserId, previousId?)` | Associate new user ID with previous |
| `Datalyr.reset()` | Clear user ID, start new session |
| `Datalyr.getAnonymousId()` | Get persistent anonymous device ID |

### Attribution
| Method | Description |
|---|---|
| `Datalyr.getAttributionData()` | Get captured attribution data |
| `Datalyr.setAttributionData(data)` | Set attribution manually |
| `Datalyr.getDeferredAttributionData()` | Get deferred deep link attribution |
| `Datalyr.updateTrackingAuthorization(enabled)` | Update ATT status |
| `Datalyr.getAppleSearchAdsAttribution()` | Get Apple Search Ads data (iOS) |
| `Datalyr.getPlatformIntegrationStatus()` | Check which integrations are active |

### Sessions
| Method | Description |
|---|---|
| `Datalyr.getCurrentSession()` | Get current session data |
| `Datalyr.endSession()` | End current session |

### Integrations
| Method | Description |
|---|---|
| `Datalyr.getSuperwallAttributes()` | Get attrs formatted for Superwall |
| `Datalyr.getRevenueCatAttributes()` | Get attrs formatted for RevenueCat |

### SKAdNetwork
| Method | Description |
|---|---|
| `Datalyr.getConversionValue(event, properties?)` | Preview conversion value |

### Queue & Status
| Method | Description |
|---|---|
| `Datalyr.flush()` | Send all queued events immediately |
| `Datalyr.getStatus()` | Get SDK status (initialized, queue, online) |
| `Datalyr.updateAutoEventsConfig(config)` | Update auto-event settings at runtime |

### Instance Methods (via `datalyr` singleton)
| Method | Description |
|---|---|
| `datalyr.getJourneySummary()` | Get journey summary (first/last touch) |
| `datalyr.getJourney()` | Get full customer journey |
| `datalyr.getPlayInstallReferrer()` | Get Play Install Referrer data (Android) |

---

## Need Help?

- **Full docs:** [docs.datalyr.com](https://docs.datalyr.com)
- **React Native SDK:** [docs.datalyr.com/sdks/mobile#react-native-sdk](https://docs.datalyr.com/sdks/mobile#react-native-sdk)
- **Superwall:** [docs.datalyr.com/integrations/superwall](https://docs.datalyr.com/integrations/superwall)
- **RevenueCat:** [docs.datalyr.com/integrations/revenuecat](https://docs.datalyr.com/integrations/revenuecat)
- **App Campaigns:** [docs.datalyr.com/features/app-campaigns](https://docs.datalyr.com/features/app-campaigns)
- **Conversion Rules:** [docs.datalyr.com/integrations/conversion-rules](https://docs.datalyr.com/integrations/conversion-rules)
- **Web SDK:** [docs.datalyr.com/sdks/web](https://docs.datalyr.com/sdks/web)
- **Email:** hello@datalyr.com
