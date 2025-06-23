# 📱 Datalyr Mobile SDK

**Complete attribution tracking + automatic events for React Native & Expo**

*Like Mixpanel's automatic events + better attribution than any competitor*

---

## 🚨 Migration Notice (v1.0.11)

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
- **[examples/auto-events-example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/auto-events-example.tsx)** - Live demo of automatic events
- **[examples/attribution-example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/attribution-example.tsx)** - Attribution testing interface
- **[examples/example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/example.tsx)** - Basic SDK usage example

### **🔧 SDK Files**
- **[src/](https://github.com/datalyr/react-native-sdk/tree/main/src)** - Complete SDK source code
- **[package.json](https://github.com/datalyr/react-native-sdk/blob/main/package.json)** - Dependencies and configuration

---

## 🎯 30-Second Integration

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

// 🎉 That's it! Automatic events happen behind the scenes
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
- `pageviews` - User navigates between screens
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

## 🏆 vs. Competitors

| Feature | Mixpanel | Amplitude | Firebase | **Datalyr** |
|---------|----------|-----------|----------|-------------|
| Attribution | ❌ | ❌ | ❌ | **✅** |
| Auto Events | ✅ | ✅ | ✅ | **✅** |
| Session Tracking | ✅ | ✅ | ✅ | **✅** |
| Offline Support | ✅ | ✅ | ✅ | **✅** |
| Ad Platform Integration | ❌ | ❌ | ❌ | **✅** |
| Revenue Tracking | ✅ | ✅ | ✅ | **✅** |

**🎯 Datalyr Advantage:** Only SDK that combines attribution + automatic events!

---

## 🎮 Try the Demo

Want to see all features in action?

1. **🧪 Complete Test App:** Run the [test-app/](https://github.com/datalyr/react-native-sdk/tree/main/test-app) - Full Expo app with all features
2. **Basic Integration:** Check out [examples/example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/example.tsx)
3. **Auto Events Demo:** Run [examples/auto-events-example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/auto-events-example.tsx)  
4. **Attribution Testing:** Use [examples/attribution-example.tsx](https://github.com/datalyr/react-native-sdk/blob/main/examples/attribution-example.tsx)

---

## 🚀 Ready to Start?

1. **📖 Choose your guide:** [FRAMEWORK_COMPARISON.md](https://github.com/datalyr/react-native-sdk/blob/main/FRAMEWORK_COMPARISON.md)
2. **⚡ Quick install:** [INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/INSTALL.md) or [EXPO_INSTALL.md](https://github.com/datalyr/react-native-sdk/blob/main/EXPO_INSTALL.md)
3. **🧪 Test attribution:** Your events appear at `https://app.datalyr.com`
4. **🎉 Launch:** Start tracking users from ad click to conversion!

---

**🔥 The only mobile SDK that tracks attribution AND provides automatic events like Mixpanel!** 

*Production-ready with 100% feature completion - attribution tracking + automatic events like Mixpanel!* 