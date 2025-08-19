# Datalyr React Native SDK - Installation Guide

## Key Features

- **Complete Attribution** - Track users from ad click to conversion
- **Automatic Events** - Sessions, screen views, app lifecycle
- **SKAdNetwork Support** - iOS 14+ attribution
- **Offline Support** - Queue events when offline
- **Deep Link Support** - Extract attribution from app launches
- **Privacy Compliant** - GDPR/CCPA support

## Quick Setup

### 1. Install Package

```bash
npm install @datalyr/react-native
# or
yarn add @datalyr/react-native
```

### 2. iOS Setup (if targeting iOS)

```bash
cd ios && pod install && cd ..
```

### 3. Initialize in Your App

**Basic Setup:**
```typescript
// App.tsx or your main component
import React, { useEffect } from 'react';
import { datalyr } from '@datalyr/react-native-sdk';

const App: React.FC = () => {
  useEffect(() => {
    initializeDatalyr();
  }, []);

  const initializeDatalyr = async () => {
    try {
      await datalyr.initialize({
        workspaceId: 'ozLZblQ8hN', // Your workspace ID
        apiKey: 'dk_your_api_key', // Required for authentication
        debug: true,
        enableAttribution: true,    // ✅ Deep link attribution tracking
        autoEvents: {
          trackSessions: true,          // ✅ Automatic session tracking
          trackScreenViews: true,       // ✅ Automatic screen tracking  
          trackAppUpdates: true,        // ✅ App version changes
          trackPerformance: true,       // ✅ App launch time, performance
          sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
        },
      });
      
      // Manual events still work (but many are now automatic!)
      await datalyr.track('app_launch');
      
      console.log('Datalyr SDK initialized with auto-events!');
    } catch (error) {
      console.error('SDK init failed:', error);
    }
  };

  // ... rest of your app
};
```

**SKAdNetwork Setup (iOS 14+ Attribution):**
```typescript
// For iOS attribution competing with AppsFlyer/Adjust
import React, { useEffect } from 'react';
import { Datalyr } from '@datalyr/react-native-sdk';

const App: React.FC = () => {
  useEffect(() => {
    initializeDatalyrWithSKAdNetwork();
  }, []);

  const initializeDatalyrWithSKAdNetwork = async () => {
    try {
      await Datalyr.initialize({
        workspaceId: 'your-workspace-id',
        apiKey: 'dk_your_api_key',
        skadTemplate: 'ecommerce', // Choose: 'ecommerce', 'gaming', 'subscription'
        debug: true,
        enableAttribution: true,
        autoEvents: {
          trackSessions: true,
          trackScreenViews: true,
        },
      });
      
      console.log('Datalyr SDK initialized with SKAdNetwork!');
    } catch (error) {
      console.error('SDK init failed:', error);
    }
  };

  // ... rest of your app
};
```

### 5. Test the Integration

```typescript
// Test tracking events
const testTracking = async () => {
  // Track a purchase
  await datalyr.track('purchase', {
    value: 29.99,
    currency: 'USD',
    item_id: 'test_product'
  });

  // Identify a user
  await datalyr.identify('user_123', {
    email: 'test@example.com',
    name: 'Test User'
  });

  // Track screen view
  await datalyr.screen('home_screen');
};
```

## Configuration Options

```typescript
await datalyr.initialize({
  workspaceId: 'your-workspace-id',     // Required
  apiKey: 'dk_your_api_key',            // Required for authentication
  debug: true,                          // Enable debug logs
  endpoint: 'custom-endpoint',          // Optional custom endpoint
  maxRetries: 3,                        // Network retry attempts
  retryDelay: 1000,                     // Retry delay in ms
  batchSize: 10,                        // Events per batch
  flushInterval: 10000,                 // Auto-flush interval in ms
  maxQueueSize: 100,                    // Max offline queue size
  
  // 🚀 NEW: SKAdNetwork Support (iOS 14+ Attribution)
  skadTemplate: 'ecommerce',            // Choose: 'ecommerce', 'gaming', 'subscription'
  
  // 🚀 NEW: Automatic Events (Like Mixpanel)
  autoEvents: {
    trackSessions: true,                // Session start/end tracking
    trackScreenViews: true,             // Automatic screen view events
    trackAppUpdates: true,              // App version change detection
    trackPerformance: true,             // App launch performance tracking
    sessionTimeoutMs: 30 * 60 * 1000,  // Session timeout (30 minutes)
  },
});
```

## Platform Requirements

- **React Native**: >= 0.60.0
- **iOS**: >= 11.0
- **Android**: >= API level 21

## Framework Compatibility

| Framework | Compatibility | Install Guide |
|-----------|---------------|---------------|
| **React Native CLI** | ✅ Full Support | This guide |
| **Expo Bare Workflow** | ✅ Full Support | This guide |
| **Expo Managed Workflow** | ✅ Supported* | [EXPO_INSTALL.md](./EXPO_INSTALL.md) |
| **Expo Go** | ⚠️ Limited | Use managed workflow |

*\*Expo managed workflow has some limitations (IDFA/GAID collection requires additional setup)*

**📖 For Expo users:** See [EXPO_INSTALL.md](./EXPO_INSTALL.md) for Expo-specific setup instructions.

## Setting Up Attribution

### 1. Configure Deep Links

Add URL scheme to your app to handle attribution links:

**iOS (ios/YourApp/Info.plist):**
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>your.app.identifier</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>yourappscheme</string>
    </array>
  </dict>
</array>
```

**Android (android/app/src/main/AndroidManifest.xml):**
```xml
<activity
  android:name=".MainActivity"
  android:exported="true"
  android:launchMode="singleTop">
  
  <intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="yourappscheme" />
  </intent-filter>
</activity>
```

### 2. Test Attribution

```typescript
// Test with Datalyr LYR tags (RECOMMENDED!)
const lyrUrl = 'yourappscheme://open?lyr=mobile_campaign_q4&utm_source=facebook&utm_medium=paid_social&utm_campaign=summer_sale&fbclid=IwAR123abc';

// Test Facebook attribution
const facebookUrl = 'yourappscheme://open?utm_source=facebook&utm_medium=paid_social&utm_campaign=summer_sale&fbclid=IwAR123abc&lyr=fb_summer_2024';

// Test TikTok attribution  
const tiktokUrl = 'yourappscheme://open?utm_source=tiktok&utm_medium=video&utm_campaign=viral_video&ttclid=tiktok123xyz&lyr=tt_viral_campaign';

// Test Google attribution
const googleUrl = 'yourappscheme://open?utm_source=google&utm_medium=search&utm_campaign=brand_search&gclid=google456def&lyr=google_brand_search';

// Test Partner attribution
const partnerUrl = 'yourappscheme://open?utm_source=partner&partner_id=partner123&affiliate_id=aff456&lyr=partner_campaign_q4';

// Get attribution data
const attributionData = datalyr.getAttributionData();
console.log('Attribution:', attributionData);
/*
Expected output:
{
  lyr: "mobile_campaign_q4",
  utm_source: "facebook", 
  campaign_source: "facebook",
  utm_campaign: "summer_sale",
  campaign_name: "summer_sale", 
  fbclid: "IwAR123abc",
  install_time: "2024-01-01T00:00:00Z"
}
*/
```

## Testing Events

After setup, events will appear in your Datalyr dashboard at:
`https://app.datalyr.com/dashboard/ozLZblQ8hN`

Look for events with `source: 'mobile_app'` to confirm mobile tracking is working.

**Key Events to Look For:**

**🔥 Automatic Events (No Code Required!):**
- `session_start` - User starts a new session (automatic)
- `session_end` - User ends session with duration/stats (automatic)
- `pageviews` - User navigates between screens (automatic)
- `app_install` - First time app opens with attribution (automatic)
- `app_update` - App version changes (automatic)
- `app_foreground` - App becomes active (automatic)
- `app_background` - App goes to background (automatic)
- `app_launch_performance` - App startup timing (automatic)
- `sdk_initialized` - SDK successfully initialized (automatic)

**📱 Manual Events (When You Call Them):**
- Custom events you track with `datalyr.track()`
- User identification with `datalyr.identify()`
- Manual screen views with `datalyr.screen()`

## Debugging

```typescript
// Check SDK status
const status = datalyr.getStatus();
console.log('SDK Status:', status);

// Manually flush events
await datalyr.flush();

// Enable debug mode
await datalyr.initialize({
  workspaceId: 'your-workspace-id',
  debug: true  // This will show detailed logs
});
```

## Common Issues

1. **Events not appearing**: Check debug logs and network connectivity
2. **Build errors**: Ensure all dependencies are installed and linked
3. **iOS build issues**: Run `cd ios && pod install`
4. **Android issues**: Check that your minSdkVersion is >= 21

## Automatic Events

Want to see all the automatic events in action? Check out `auto-events-example.tsx` for a live demo that shows:

- Real-time session tracking with duration and screen counts
- Automatic screen view detection as you navigate
- App lifecycle events (foreground/background)
- Revenue event tracking for purchases
- Session management and timeout handling

```typescript
// Get current session info
const session = datalyr.getCurrentSession();
console.log('Current session:', session);
// Output: { sessionId: 'sess_123', startTime: 1640995200000, screenViews: 5, events: 12 }

// Manual revenue tracking (also triggers automatic revenue_event)
await datalyr.trackRevenue('purchase', {
  product_id: 'premium_plan',
  price: 9.99,
  currency: 'USD',
});

// Force end session for testing
await datalyr.endSession();
```

## Next Steps

- See `example.tsx` for basic integration example
- See `auto-events-example.tsx` for automatic events demo
- Check your Datalyr dashboard to verify events are coming through
- Set up attribution tracking for your ad campaigns
- Configure conversion events for your key user actions

---

## SKAdNetwork Setup (iOS Attribution)

### **1. Add Native Bridge (React Native CLI/Expo Bare)**

Create `ios/YourApp/DatalyrSKAdNetwork.m`:
```objc
#import <React/RCTBridgeModule.h>
#import <StoreKit/StoreKit.h>

@interface DatalyrSKAdNetwork : NSObject <RCTBridgeModule>
@end

@implementation DatalyrSKAdNetwork

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(updateConversionValue:(NSInteger)value
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 14.0, *)) {
        @try {
            [SKAdNetwork updateConversionValue:value];
            resolve(@(YES));
        } @catch (NSException *exception) {
            reject(@"skadnetwork_error", exception.reason, nil);
        }
    } else {
        reject(@"ios_version_error", @"SKAdNetwork requires iOS 14.0+", nil);
    }
}

@end
```

### **2. Track Events with SKAdNetwork**

```typescript
import { Datalyr } from '@datalyr/react-native-sdk';

// Track events with automatic conversion value encoding
await Datalyr.trackPurchase(29.99, 'USD', 'premium_plan');
await Datalyr.trackWithSKAdNetwork('add_to_cart', { product_id: 'shirt_001' });
await Datalyr.trackWithSKAdNetwork('level_complete', { level: 5, score: 1250 });

// Test conversion values (doesn't send to Apple)
const value = Datalyr.getConversionValue('purchase', { revenue: 29.99 });
console.log('Conversion value:', value); // Example: 5
```

### **3. Industry Templates**

Choose the template that best fits your app:

**E-commerce (`skadTemplate: 'ecommerce'`):**
- Optimized for: purchase, add_to_cart, begin_checkout, signup, subscribe, view_item
- Revenue encoding: 8 tiers from $0-1 to $250+

**Gaming (`skadTemplate: 'gaming'`):**
- Optimized for: level_complete, tutorial_complete, purchase, achievement_unlocked, session_start, ad_watched
- Revenue encoding for in-app purchases

**Subscription (`skadTemplate: 'subscription'`):**
- Optimized for: trial_start, subscribe, upgrade, cancel, signup, payment_method_added
- Revenue encoding for subscription plans

---

**Ready to test? Your mobile attribution + automatic events + SKAdNetwork are now live! 🚀**

*Compete with AppsFlyer/Adjust at 90% cost savings while getting Mixpanel-style automatic events!* 