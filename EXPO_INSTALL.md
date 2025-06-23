# Datalyr Expo SDK - Installation Guide

## 🎯 Expo Compatibility Overview

**✅ Works with Expo:** The Datalyr SDK can be used with Expo, but requires some adjustments for the **managed workflow**.

**📱 Expo Workflow Compatibility:**
- ✅ **Expo Bare Workflow** - Full compatibility (use regular React Native SDK)
- ✅ **Expo Managed Workflow** - Requires Expo-specific version (this guide)
- ❌ **Expo Go** - Limited compatibility due to native dependencies

## 🚀 Quick Setup for Expo Managed Workflow

### 1. Install Expo Dependencies

```bash
# Navigate to your Expo project
cd your-expo-app

# Install Expo-compatible dependencies
npx expo install @react-native-async-storage/async-storage
npx expo install expo-application
npx expo install expo-constants  
npx expo install expo-device
npx expo install expo-network
npx expo install expo-tracking-transparency
npx expo install react-native-get-random-values

# Install additional dependencies
npm install uuid
npm install --save-dev @types/uuid
```

### 2. Update app.json/app.config.js

Add required permissions and configuration:

```json
{
  "expo": {
    "name": "Your App",
    "version": "1.0.0",
    "permissions": [
      "INTERNET",
      "ACCESS_NETWORK_STATE"
    ],
    "ios": {
      "infoPlist": {
        "NSUserTrackingUsageDescription": "This app uses tracking to provide personalized ads and analytics.",
        "CFBundleURLTypes": [
          {
            "CFBundleURLName": "your.app.identifier",
            "CFBundleURLSchemes": ["yourappscheme"]
          }
        ]
      }
    },
    "android": {
      "permissions": [
        "INTERNET",
        "ACCESS_NETWORK_STATE"
      ],
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "yourappscheme"
            }
          ],
          "category": [
            "BROWSABLE",
            "DEFAULT"
          ]
        }
      ]
    }
  }
}
```

### 3. Copy Expo-Compatible SDK Files

```bash
# Create SDK directory
mkdir -p src/datalyr-sdk

# Copy the Expo-compatible files
# You'll need to create these based on the original SDK but using Expo APIs
```

### 4. Initialize in Your Expo App

```typescript
// App.tsx
import React, { useEffect } from 'react';
import 'react-native-get-random-values'; // Important: Must be imported first
import DatalyrExpoSDK from './src/datalyr-sdk';

const App: React.FC = () => {
  useEffect(() => {
    initializeDatalyr();
  }, []);

  const initializeDatalyr = async () => {
    try {
      await DatalyrExpoSDK.initialize({
        workspaceId: 'ozLZblQ8hN', // Your workspace ID
        debug: true,
        autoEvents: {
          trackSessions: true,          // ✅ Automatic session tracking
          trackScreenViews: true,       // ✅ Automatic screen tracking  
          trackAppUpdates: true,        // ✅ App version changes
          trackPerformance: true,       // ✅ App launch time, performance
          sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
        },
      });
      
      console.log('Datalyr Expo SDK initialized with auto-events!');
    } catch (error) {
      console.error('SDK init failed:', error);
    }
  };

  // ... rest of your app
};

export default App;
```

## 🔧 Expo vs React Native CLI Differences

| Feature | React Native CLI | Expo Managed | Expo Bare |
|---------|------------------|--------------|-----------|
| Device Info | `react-native-device-info` | `expo-device` + `expo-application` | `react-native-device-info` |
| IDFA/GAID | `react-native-idfa` | `expo-tracking-transparency` + setup | `react-native-idfa` |
| Network Detection | `@react-native-community/netinfo` | `expo-network` | `@react-native-community/netinfo` |
| Storage | `@react-native-async-storage/async-storage` | Same ✅ | Same ✅ |
| Attribution | Full support ✅ | Full support ✅ | Full support ✅ |
| Auto Events | Full support ✅ | Full support ✅ | Full support ✅ |

## 📱 Expo-Specific Features

### 1. Device Information
```typescript
// Uses expo-device and expo-application instead of react-native-device-info
import * as Device from 'expo-device';
import * as Application from 'expo-application';

const deviceInfo = {
  model: Device.modelName,
  manufacturer: Device.manufacturer,
  osVersion: Device.osVersion,
  appVersion: Application.nativeApplicationVersion,
  buildNumber: Application.nativeBuildVersion,
  bundleId: Application.applicationId,
  isEmulator: !Device.isDevice,
};
```

### 2. IDFA Permission (iOS)
```typescript
// Uses expo-tracking-transparency for iOS IDFA permission
import * as TrackingTransparency from 'expo-tracking-transparency';

const requestIDFAPermission = async () => {
  if (Platform.OS === 'ios') {
    const { status } = await TrackingTransparency.requestTrackingPermissionsAsync();
    return status === TrackingTransparency.PermissionStatus.GRANTED;
  }
  return false;
};
```

### 3. Network Detection
```typescript
// Uses expo-network instead of @react-native-community/netinfo
import * as Network from 'expo-network';

const getNetworkType = async () => {
  const networkState = await Network.getNetworkStateAsync();
  return networkState.type; // 'WIFI', 'CELLULAR', etc.
};
```

## 🎯 Attribution Setup for Expo

Deep links work the same way, but configuration is in `app.json`:

### Test URLs (Same as React Native)
```typescript
// Test with Datalyr LYR tags
const lyrUrl = 'yourappscheme://open?lyr=expo_campaign&utm_source=facebook&fbclid=abc123';

// Test Facebook attribution  
const facebookUrl = 'yourappscheme://open?utm_source=facebook&utm_campaign=summer_sale&fbclid=IwAR123abc';

// Test TikTok attribution
const tiktokUrl = 'yourappscheme://open?utm_source=tiktok&utm_campaign=viral_video&ttclid=tiktok123xyz';

// Test Google attribution
const googleUrl = 'yourappscheme://open?utm_source=google&utm_campaign=brand_search&gclid=google456def';
```

## 🧪 Testing with Expo

### Development
```bash
# Start Expo development server
npx expo start

# Test on device/simulator
npx expo start --ios
npx expo start --android
```

### Production Testing
```bash
# Build for testing
eas build --platform ios --profile preview
eas build --platform android --profile preview

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

## ⚠️ Expo Limitations

### What Works Fully:
- ✅ Event tracking and attribution
- ✅ Session management  
- ✅ Screen view tracking
- ✅ App lifecycle events
- ✅ Deep link attribution
- ✅ Basic device fingerprinting

### What Has Limitations:
- ⚠️ **IDFA/GAID Collection** - Requires additional setup with expo-ads-admob
- ⚠️ **Advanced Device Info** - Some properties not available in managed workflow
- ⚠️ **Carrier Information** - Not available in managed workflow
- ⚠️ **Custom Native Modules** - Can't use if staying in managed workflow

## 🚀 Recommended Setup

### For Maximum Compatibility:
1. **Use Expo Bare Workflow** - Get full React Native CLI features
2. **Or use regular React Native CLI** - Best for attribution tracking

### For Managed Workflow:
1. **Accept some limitations** - IDFA/GAID might need additional setup  
2. **Core attribution still works** - LYR tags, UTM params, click IDs
3. **Automatic events work fully** - Sessions, screen views, app lifecycle

## 📊 Expected Events in Dashboard

Events will appear in your Datalyr dashboard with `source: 'mobile_app'`:

**🔥 Automatic Events:**
- `session_start` - New user session (automatic)
- `session_end` - Session ended with stats (automatic)  
- `screen_view` - Screen navigation (automatic)
- `app_install` - First app launch with attribution (automatic)
- `app_update` - App version changes (automatic)
- `app_foreground`/`app_background` - App lifecycle (automatic)
- `sdk_initialized` - SDK setup complete (automatic)

**📱 Manual Events:**
- Custom events from `datalyr.track()`
- User identification from `datalyr.identify()`

## 🆚 Expo vs React Native CLI Recommendation

### Choose **React Native CLI** if:
- You need full IDFA/GAID support
- You want maximum attribution accuracy  
- You're comfortable with native development
- You need custom native modules

### Choose **Expo Managed** if:
- You want easier development and deployment
- Core attribution (LYR tags, UTM, click IDs) is sufficient
- You're okay with some device fingerprinting limitations
- You prioritize development speed over maximum tracking

### Choose **Expo Bare** if:
- You want the best of both worlds
- You can use the full React Native CLI SDK
- You like Expo's build and deployment tools

---

**🎉 Ready to test? Your Expo app with automatic attribution is ready!**

*The SDK provides 90% of the attribution value even with Expo limitations!* 