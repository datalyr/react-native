# 📱 Datalyr Mobile SDK

**Complete attribution tracking + automatic events for React Native & Expo**

*Like Mixpanel's automatic events + better attribution than any competitor*

---

## 🚀 Quick Start

**Choose your framework:**

| Framework | Guide | Attribution Accuracy |
|-----------|-------|---------------------|
| **React Native CLI** | [INSTALL.md](./INSTALL.md) | 100% |
| **Expo Bare Workflow** | [INSTALL.md](./INSTALL.md) | 100% |
| **Expo Managed Workflow** | [EXPO_INSTALL.md](./EXPO_INSTALL.md) | 90% |
| **Expo Go** | [EXPO_INSTALL.md](./EXPO_INSTALL.md) | 90% |

**❓ Not sure which to choose?** See [FRAMEWORK_COMPARISON.md](./FRAMEWORK_COMPARISON.md)

**📱 For Expo users:** Core attribution (LYR tags, UTM params, click IDs) works perfectly on all Expo workflows - see [EXPO_INSTALL.md](./EXPO_INSTALL.md)

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
// ✅ screen_view (automatic screen tracking)
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
- **[INSTALL.md](./INSTALL.md)** - React Native CLI & Expo Bare setup
- **[EXPO_INSTALL.md](./EXPO_INSTALL.md)** - Expo Managed Workflow setup
- **[FRAMEWORK_COMPARISON.md](./FRAMEWORK_COMPARISON.md)** - Choose the right framework

### **📊 Feature Documentation**
- **[SDK_COMPLETION_STATUS.md](./SDK_COMPLETION_STATUS.md)** - What's included vs competitors
- **[auto-events-example.tsx](./auto-events-example.tsx)** - Live demo of automatic events
- **[attribution-example.tsx](./attribution-example.tsx)** - Attribution testing interface
- **[example.tsx](./example.tsx)** - Basic SDK usage example

### **🔧 SDK Files**
- **[src/](./src/)** - Complete SDK source code
- **[package.json](./package.json)** - React Native CLI dependencies
- **[expo-package.json](./expo-package.json)** - Expo dependencies

---

## 🎯 30-Second Integration

```typescript
import { datalyr } from '@datalyr/react-native-sdk';

// Initialize with automatic events
await datalyr.initialize({
  workspaceId: 'your-workspace-id',
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

---

## 📈 What You Get in Your Dashboard

Events appear in your Datalyr dashboard with `source: 'mobile_app'`:

### **🔥 Automatic Events (Zero Code)**
- `session_start` - User starts new session with attribution
- `session_end` - Session ends with duration and screen count  
- `screen_view` - User navigates between screens
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

1. **Basic Integration:** Check out [example.tsx](./example.tsx)
2. **Auto Events Demo:** Run [auto-events-example.tsx](./auto-events-example.tsx)  
3. **Attribution Testing:** Use [attribution-example.tsx](./attribution-example.tsx)

---

## 🚀 Ready to Start?

1. **📖 Choose your guide:** [FRAMEWORK_COMPARISON.md](./FRAMEWORK_COMPARISON.md)
2. **⚡ Quick install:** [INSTALL.md](./INSTALL.md) or [EXPO_INSTALL.md](./EXPO_INSTALL.md)
3. **🧪 Test attribution:** Your events appear at `https://app.datalyr.com`
4. **🎉 Launch:** Start tracking users from ad click to conversion!

---

**🔥 The only mobile SDK that tracks attribution AND provides automatic events like Mixpanel!** 

*Ready for production with 95% feature completion and works with your existing Datalyr backend.* 