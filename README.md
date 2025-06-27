# 📱 Datalyr Mobile SDK

**Complete attribution tracking + automatic events for React Native & Expo**

*Like Mixpanel's automatic events + better attribution than any competitor*

---

## 🚨 Migration Notice

### **🚀 NEW in v2.0.0: SKAdNetwork Support!**
**Compete with AppsFlyer/Adjust at 90% cost savings:**
- Add `skadTemplate: 'ecommerce'` to your `initialize()` call for automatic iOS 14+ attribution
- Use `Datalyr.trackPurchase()` and `Datalyr.trackWithSKAdNetwork()` for conversion tracking
- Choose from 3 industry templates: `'ecommerce'`, `'gaming'`, `'subscription'`
- **Benefit**: Same SKAdNetwork functionality as enterprise MMPs at $49/month instead of $500/month
- See [SKAdNetwork Quick Setup](#-skadnetwork-quick-setup-ios-attribution) below for details

### **v1.0.11 Changes:**
**BREAKING CHANGE**: API key is now required for authentication:
- Add `apiKey: 'dk_your_api_key'` to your `initialize()` call
- Get your API key from your web tracking script tag (`data-api-key` attribute)
- This fixes 401 authentication errors with the Datalyr API

**NEW**: Attribution tracking must be explicitly enabled:
- Add `enableAttribution: true` to your `initialize()` call to track deep link parameters
- This enables UTM parameters, click IDs (fbclid, gclid, ttclid), and LYR tags
- **Action Required**: Add this to your config to enable attribution tracking

**Previous Update (v1.0.3)**: Screen tracking events renamed for web consistency:
- `screen_view` → `pageview` 
- **Action Required**: Update any custom analytics queries or dashboards that reference `screen_view` events

---

## 🚀 Quick Start

**Choose your framework:**

| Framework | Guide | Attribution Accuracy |
|-----------|-------|---------------------|
| **React Native CLI** | [INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/INSTALL.md) | 100% |
| **Expo Bare Workflow** | [INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/INSTALL.md) | 100% |
| **Expo Managed Workflow** | [EXPO_INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/EXPO_INSTALL.md) | 90% |
| **Expo Go** | [EXPO_INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/EXPO_INSTALL.md) | 90% |

**❓ Not sure which to choose?** See [FRAMEWORK_COMPARISON.md](https://github.com/datalyr/react-native-sdk/blob/main/FRAMEWORK_COMPARISON.md)

**📱 For Expo users:** Core attribution (LYR tags, UTM params, click IDs) works perfectly on all Expo workflows - see [EXPO_INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/EXPO_INSTALL.md)

---

## ✨ What Makes This SDK Special

### 🎯 **Complete Attribution**
```typescript
// Tracks users from ad click to conversion
// ✅ Facebook (fbclid), TikTok (ttclid), Google (gclid)
// ✅ UTM parameters (utm_source, utm_medium, utm_campaign)
// ✅ LYR tags (lyr, datalyr, dl_tag) - Datalyr's custom system
// ✅ Deep link attribution with install detection
```

### 📊 **SKAdNetwork Integration (iOS 14+)**
```typescript
// Automatic conversion value encoding - compete with AppsFlyer/Adjust at 90% cost savings!
// ✅ Industry templates: E-commerce, Gaming, Subscription
// ✅ Automatic revenue tier encoding (8 tiers: $0-1, $1-5, $5-10, $10-25, $25-50, $50-100, $100-250, $250+)
// ✅ Event priority optimization for maximum attribution
// ✅ Unified web + mobile analytics dashboard
```

### 📊 **Automatic Events (Like Mixpanel)**
```typescript
// No manual tracking required - events happen automatically!
// ✅ session_start / session_end
// ✅ pageviews (automatic screen tracking)
// ✅ app_foreground / app_background  
// ✅ app_install (with attribution data)
// ✅ app_update (version changes)
// ✅ app_launch_performance
// ✅ revenue_event (purchase tracking)
```

### 🔒 **Production Ready**
```typescript
// ✅ Offline support with automatic retry
// ✅ Session management (30-min timeout)
// ✅ Device fingerprinting (IDFA/GAID)
// ✅ Privacy compliant (GDPR/CCPA)
// ✅ Works with existing Supabase backend
```

---

## 📁 Documentation & Guides

### **🚀 Installation Guides**
- **[INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/INSTALL.md)** - React Native CLI & Expo Bare setup
- **[EXPO_INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/EXPO_INSTALL.md)** - Expo Managed Workflow setup
- **[FRAMEWORK_COMPARISON.md](https://github.com/datalyr/react-native-sdk/blob/main/FRAMEWORK_COMPARISON.md)** - Choose the right framework

### **📊 Feature Documentation**
- **[SDK_COMPLETION_STATUS.md](https://github.com/datalyr/react-native-sdk/blob/main/SDK_COMPLETION_STATUS.md)** - What's included vs competitors
- **[test-app/](https://github.com/datalyr/react-native-sdk/tree/main/test-app)** - 🧪 **Complete test app** - Ready-to-run Expo app demonstrating all features
- **[examples/skadnetwork-example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/skadnetwork-example.tsx)** - 🚀 **SKAdNetwork demo** - Complete interface for testing all templates
- **[examples/auto-events-example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/auto-events-example.tsx)** - Live demo of automatic events
- **[examples/attribution-example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/attribution-example.tsx)** - Attribution testing interface
- **[examples/example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/example.tsx)** - Basic SDK usage example

### **🔧 SDK Files**
- **[src/](https://github.com/datalyr/react-native-sdk/tree/main/src)** - Complete SDK source code
- **[package.json](https://github.com/datalyr/react-native-sdk/blob/main/package.json)** - Dependencies and configuration

---

## 🎯 30-Second Integration

**Basic Setup:**
```typescript
import { datalyr } from '@datalyr/react-native-sdk';

// Initialize with automatic events
await datalyr.initialize({
  workspaceId: 'your-workspace-id',
  apiKey: 'dk_your_api_key', // Required for authentication
  enableAttribution: true,    // ✅ Deep link attribution tracking
  autoEvents: {
    trackSessions: true,        // ✅ Session start/end
    trackScreenViews: true,     // ✅ Automatic screen tracking  
    trackAppUpdates: true,      // ✅ App version changes
    trackPerformance: true,     // ✅ App launch performance
  },
});

// Manual events still work (but many are now automatic!)
await datalyr.track('purchase', { value: 29.99, currency: 'USD' });
await datalyr.identify('user_123', { email: 'user@example.com' });
await datalyr.screen('home_screen');
```

**🚀 NEW: SKAdNetwork Setup (iOS 14+ Attribution):**
```typescript
import { Datalyr } from '@datalyr/react-native-sdk';

// Initialize with SKAdNetwork for iOS attribution
await Datalyr.initialize({
  workspaceId: 'your-workspace-id',
  apiKey: 'dk_your_api_key',
  skadTemplate: 'ecommerce', // 'ecommerce', 'gaming', or 'subscription'
  enableAttribution: true,
  autoEvents: { trackSessions: true, trackScreenViews: true },
});

// Track events with automatic SKAdNetwork encoding
await Datalyr.trackPurchase(29.99, 'USD', 'premium_plan');
await Datalyr.trackWithSKAdNetwork('add_to_cart', { product_id: 'shirt_001' });

// 🎉 Automatic conversion value encoding sends to Apple!
```

## 🧪 **Want to Test First?**

Try our complete test app before integrating:

```bash
# Clone the repository
git clone https://github.com/datalyr/react-native-sdk.git
cd react-native-sdk/test-app

# Install and run
npm install
npx expo start
```

The test app demonstrates all SDK features with real-time logging!

---

## 📈 What You Get in Your Dashboard

Events appear in your Datalyr dashboard with `source: 'mobile_app'`:

### **🔥 Automatic Events (Zero Code)**
- `session_start` - User starts new session with attribution
- `session_end` - Session ends with duration and screen count  
- `pageview` - User navigates between screens
- `app_install` - First app launch with full attribution
- `app_update` - App version changes
- `app_foreground` - App becomes active
- `app_background` - App goes to background  
- `app_launch_performance` - App startup timing
- `revenue_event` - Purchase/subscription tracking

### **📱 Manual Events (When You Call Them)**
- Custom events from `datalyr.track()`
- User identification from `datalyr.identify()`
- Manual screen views from `datalyr.screen()`

---

## 🏆 vs. Enterprise MMPs

| Feature | AppsFlyer | Adjust | Mixpanel | **Datalyr** |
|---------|-----------|--------|----------|-------------|
| SKAdNetwork | ✅ ($300/mo) | ✅ ($500/mo) | ❌ | **✅ ($49/mo)** |
| Attribution | ✅ | ✅ | ❌ | **✅** |
| Auto Events | ❌ | ❌ | ✅ | **✅** |
| Web + Mobile | ❌ | ❌ | ✅ | **✅** |
| Revenue Optimization | ✅ | ✅ | ✅ | **✅** |
| Industry Templates | ✅ | ✅ | ❌ | **✅** |
| Cost | $300-3000/mo | $500-5000/mo | $20-2000/mo | **$49-499/mo** |

**🎯 Datalyr Advantage:** Same SKAdNetwork functionality as enterprise MMPs at 90% cost savings + unified web analytics!

---

## 🎮 Try the Demo

Want to see all features in action?

1. **🚀 SKAdNetwork Demo:** Try [examples/skadnetwork-example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/skadnetwork-example.tsx) - Test all industry templates with real-time conversion values
2. **🧪 Complete Test App:** Run the [test-app/](https://github.com/datalyr/react-native-sdk/tree/main/test-app) - Full Expo app with all features
3. **Auto Events Demo:** Run [examples/auto-events-example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/auto-events-example.tsx)  
4. **Attribution Testing:** Use [examples/attribution-example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/attribution-example.tsx)
5. **Basic Integration:** Check out [examples/example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/example.tsx)

---

## 🚀 Ready to Start?

1. **📖 Choose your guide:** [FRAMEWORK_COMPARISON.md](https://github.com/datalyr/react-native-sdk/blob/main/FRAMEWORK_COMPARISON.md)
2. **⚡ Quick install:** [INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/INSTALL.md) or [EXPO_INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/EXPO_INSTALL.md)
3. **🧪 Test attribution:** Your events appear at `https://app.datalyr.com`
4. **🎉 Launch:** Start tracking users from ad click to conversion!

---

**🔥 The only mobile SDK that combines SKAdNetwork attribution + automatic events + unified web analytics!** 

*Compete with AppsFlyer/Adjust at 90% cost savings while getting Mixpanel-style automatic events!*

---

## 🚀 SKAdNetwork Quick Setup (iOS Attribution)

### **1. Add Native Bridge (React Native CLI/Expo Bare):**

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
        [SKAdNetwork updateConversionValue:value];
        resolve(@(YES));
    } else {
        reject(@"ios_version_error", @"SKAdNetwork requires iOS 14.0+", nil);
    }
}
@end
```

### **2. Initialize with Template:**
```typescript
import { Datalyr } from '@datalyr/react-native-sdk';

await Datalyr.initialize({
  workspaceId: 'your-workspace-id',
  apiKey: 'your-api-key',
  skadTemplate: 'ecommerce', // Choose: 'ecommerce', 'gaming', 'subscription'
});
```

### **3. Track Events:**
```typescript
// Automatic SKAdNetwork encoding for iOS 14+
await Datalyr.trackPurchase(29.99, 'USD', 'premium_plan');
await Datalyr.trackWithSKAdNetwork('add_to_cart', { product_id: 'shirt_001' });

// Test conversion values (doesn't send to Apple)
const value = Datalyr.getConversionValue('purchase', { revenue: 29.99 });
console.log('Conversion value:', value); // Example: 5
```

### **4. Revenue Encoding:**
The SDK automatically maps revenue to 8 optimized tiers:
- $0-1 → Tier 0, $1-5 → Tier 1, $5-10 → Tier 2, $10-25 → Tier 3
- $25-50 → Tier 4, $50-100 → Tier 5, $100-250 → Tier 6, $250+ → Tier 7

**🎯 Result:** Same attribution as AppsFlyer/Adjust at $49/month instead of $500/month! 
