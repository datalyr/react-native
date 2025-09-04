# @datalyr/react-native

Official Datalyr SDK for React Native & Expo - Mobile attribution tracking and analytics.

[![npm version](https://img.shields.io/npm/v/@datalyr/react-native.svg)](https://www.npmjs.com/package/@datalyr/react-native)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🎯 **Complete Attribution** - Track users from ad click to conversion
- 📱 **React Native & Expo** - Works with both platforms
- 🔄 **Automatic Events** - Session tracking, screen views, app lifecycle
- 📊 **SKAdNetwork** - iOS 14+ attribution support
- 💾 **Offline Support** - Events saved and retried when reconnected
- 🔒 **Privacy First** - GDPR/CCPA compliant
- ⚡ **Lightweight** - < 100KB, minimal battery impact
- 🆔 **Identity Resolution** - Persistent anonymous ID links web → mobile → server events

## Installation

```bash
npm install @datalyr/react-native
# or
yarn add @datalyr/react-native
```

### iOS Setup

```bash
cd ios && pod install
```

### Expo Users

See [EXPO_INSTALL.md](./EXPO_INSTALL.md) for Expo-specific setup instructions.

## Quick Start

```typescript
import { Datalyr } from '@datalyr/react-native';

// Initialize SDK
await Datalyr.initialize({
  apiKey: 'dk_your_api_key', // Required - get from Datalyr dashboard
  debug: true, // Enable debug logs in development
  enableAutoEvents: true, // Track sessions, screen views, app lifecycle
  enableAttribution: true, // Track attribution data from ads
});

// Track custom event
await Datalyr.track('Button Clicked', {
  button_name: 'purchase',
  value: 99.99,
});

// Identify user
await Datalyr.identify('user_123', {
  email: 'user@example.com',
  plan: 'premium',
});
```

## Configuration

```typescript
interface DatalyrConfig {
  apiKey: string;              // Required - Your API key
  workspaceId?: string;        // Optional - For legacy support
  debug?: boolean;             // Enable debug logging
  endpoint?: string;           // Custom API endpoint
  useServerTracking?: boolean; // Default: true
  enableAutoEvents?: boolean;  // Track lifecycle events
  enableAttribution?: boolean; // Track attribution data
  skadTemplate?: 'ecommerce' | 'gaming' | 'subscription'; // SKAdNetwork
  maxQueueSize?: number;       // Default: 100
  flushInterval?: number;      // Default: 30000ms
}
```

## Core Methods

### Initialize
```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  enableAutoEvents: true,
});
```

### Track Events
```typescript
// Simple event
await Datalyr.track('Product Viewed');

// Event with properties
await Datalyr.track('Purchase Completed', {
  product_id: 'SKU123',
  amount: 49.99,
  currency: 'USD',
});
```

### Identify Users
```typescript
await Datalyr.identify('user_123', {
  email: 'user@example.com',
  name: 'John Doe',
  plan: 'premium',
  company: 'Acme Inc',
});
```

### Track Screen Views
```typescript
await Datalyr.screen('Product Details', {
  product_id: 'SKU123',
  category: 'Electronics',
});
```

### Track Revenue
```typescript
// Purchase tracking with SKAdNetwork
await Datalyr.trackPurchase(99.99, 'USD', 'premium_subscription');

// Subscription tracking
await Datalyr.trackSubscription(9.99, 'USD', 'monthly_pro');

// Custom revenue event
await Datalyr.trackRevenue('In-App Purchase', {
  product_id: 'coins_1000',
  amount: 4.99,
  currency: 'USD',
});
```

## Attribution Tracking

The SDK automatically tracks:
- Deep links and Universal Links
- UTM parameters
- Referrer data
- Install attribution
- Platform click IDs (fbclid, gclid, ttclid, etc.)

### Get Attribution Data
```typescript
const attribution = Datalyr.getAttributionData();
console.log(attribution);
// {
//   campaign: 'summer_sale',
//   source: 'facebook',
//   medium: 'social',
//   fbclid: 'abc123',
//   ...
// }
```

### Set Custom Attribution
```typescript
await Datalyr.setAttributionData({
  campaign: 'email_campaign',
  source: 'newsletter',
  medium: 'email',
});
```

## Identity Resolution (New in v1.1.0)

The SDK now includes persistent anonymous IDs for complete user journey tracking:

```typescript
// Get anonymous ID (persists across app sessions)
const anonymousId = Datalyr.getAnonymousId();

// Pass to your backend for attribution preservation
await fetch('/api/purchase', {
  method: 'POST',
  body: JSON.stringify({
    items: cart,
    anonymous_id: anonymousId  // Links server events to mobile events
  })
});

// Identity is automatically linked when you identify a user
await Datalyr.identify('user_123', {
  email: 'user@example.com'
});
// This creates a $identify event that links anonymous_id to user_id
```

### Key Benefits:
- **Attribution Preservation**: Never lose fbclid, gclid, ttclid, or lyr tracking
- **Complete Journey**: Track users from web → app → server
- **Automatic Linking**: Identity resolution happens automatically

## Session Management

Sessions are tracked automatically with a 30-minute timeout.

```typescript
// Get current session
const session = Datalyr.getCurrentSession();

// Manually end session
await Datalyr.endSession();

// Reset user (logout)
await Datalyr.reset();
```

## SKAdNetwork Support (iOS)

Enable SKAdNetwork conversion value tracking:

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  skadTemplate: 'ecommerce', // or 'gaming', 'subscription'
});

// Events automatically update conversion values
await Datalyr.trackPurchase(99.99, 'USD');

// Get conversion value for testing
const value = Datalyr.getConversionValue('purchase', { revenue: 50 });
console.log('Conversion value:', value); // 0-63
```

## Automatic Events

When `enableAutoEvents` is true, the SDK tracks:

- `app_install` - First app open
- `app_open` - App launches
- `app_background` - App enters background
- `app_foreground` - App returns to foreground
- `app_update` - App version changes
- `session_start` - New session begins
- `session_end` - Session expires

## Offline Support

Events are automatically queued when offline and sent when connection is restored.

```typescript
// Manually flush queue
await Datalyr.flush();

// Get queue status
const status = Datalyr.getStatus();
console.log('Queue size:', status.queueStats.queueSize);
```

## Debug Mode

Enable debug logging during development:

```typescript
await Datalyr.initialize({
  apiKey: 'dk_your_api_key',
  debug: true, // Enable console logs
});
```

## TypeScript Support

Full TypeScript support with type definitions included:

```typescript
import { 
  Datalyr, 
  DatalyrConfig, 
  EventData, 
  UserProperties,
  AttributionData 
} from '@datalyr/react-native';
```

## Expo Support

Works with Expo managed and bare workflows:

```typescript
// expo.config.js
export default {
  plugins: [
    // No additional config needed
  ],
};
```

## Migration from v0.x

If migrating from an older version:

```typescript
// Old (v0.x)
import datalyr from '@datalyr/react-native-sdk';
datalyr.initialize({ workspaceId: 'ws_123' });

// New (v1.0+)
import { Datalyr } from '@datalyr/react-native';
await Datalyr.initialize({ apiKey: 'dk_your_api_key' });
```

## API Reference

### Methods

| Method | Description |
|--------|-------------|
| `initialize(config)` | Initialize SDK with configuration |
| `track(event, properties?)` | Track custom event |
| `identify(userId, properties?)` | Identify user |
| `screen(name, properties?)` | Track screen view |
| `alias(newUserId, previousId?)` | Create user alias |
| `reset()` | Reset user session |
| `flush()` | Flush event queue |
| `getStatus()` | Get SDK status |
| `getAttributionData()` | Get attribution data |
| `setAttributionData(data)` | Set attribution data |
| `getCurrentSession()` | Get current session |
| `endSession()` | End current session |
| `trackPurchase(value, currency, productId?)` | Track purchase |
| `trackSubscription(value, currency, plan?)` | Track subscription |
| `trackRevenue(event, properties?)` | Track revenue event |

## Troubleshooting

### Events not appearing?
1. Check your API key is correct
2. Enable debug mode to see logs
3. Verify network connectivity
4. Check `getStatus()` for queue information

### Authentication errors?
- Ensure API key starts with `dk_`
- Get your API key from: https://app.datalyr.com/settings/api-keys

### Build errors?
```bash
# Clear caches
npx react-native clean-project

# iOS specific
cd ios && pod install
```

## Support

- 📧 Email: support@datalyr.com
- 📚 Docs: https://docs.datalyr.com
- 🐛 Issues: https://github.com/datalyr/react-native/issues

## License

MIT © Datalyr

---

Built with ❤️ by [Datalyr](https://datalyr.com)