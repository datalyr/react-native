# 🐛 Debug White Screen Issue

## Step 1: Check SDK Version

First, verify you're using the latest version:

```bash
# Check what version is installed
npm list @datalyr/react-native-sdk

# Update to latest version
npm install @datalyr/react-native-sdk@1.0.3

# Or with yarn
yarn add @datalyr/react-native-sdk@1.0.3
```

## Step 2: Check Import Pattern

Make sure you're using the correct import:

```typescript
// ✅ CORRECT (v1.0.3+)
import { datalyr } from '@datalyr/react-native-sdk';

// ❌ WRONG (causes white screen)
import Datalyr from '@datalyr/react-native-sdk';
import DatalyrSDK from '@datalyr/react-native-sdk';
```

## Step 3: Enable Debug Logging

Add debug logging to see what's happening:

```typescript
import { datalyr } from '@datalyr/react-native-sdk';

const App = () => {
  useEffect(() => {
    initializeSDK();
  }, []);

  const initializeSDK = async () => {
    try {
      console.log('🚀 Starting SDK initialization...');
      
      await datalyr.initialize({
        workspaceId: 'your-workspace-id',
        debug: true,  // Enable debug logs
        autoEvents: {
          trackSessions: true,
          trackScreenViews: true,
          trackAppUpdates: true,
          trackPerformance: true,
        },
      });
      
      console.log('✅ SDK initialized successfully');
      
    } catch (error) {
      console.error('❌ SDK initialization failed:', error);
      // Don't let SDK errors crash the app
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>App is working!</Text>
    </View>
  );
};
```

## Step 4: Check Metro/React Native Logs

Run your app and check the logs:

```bash
# For React Native CLI
npx react-native run-ios --verbose
# or
npx react-native run-android --verbose

# For Expo
expo start --clear
```

Look for errors like:
- `TypeError: Cannot read property 'initialize' of undefined`
- `ReferenceError: datalyr is not defined`
- Any red error messages

## Step 5: Test with Minimal Setup

Create a minimal test component:

```typescript
// TestSDK.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, Alert } from 'react-native';

// Test 1: Check if import works
try {
  const { datalyr } = require('@datalyr/react-native-sdk');
  console.log('✅ Import successful:', typeof datalyr);
} catch (error) {
  console.error('❌ Import failed:', error);
}

const TestSDK = () => {
  const [status, setStatus] = useState('Testing...');

  useEffect(() => {
    testSDK();
  }, []);

  const testSDK = async () => {
    try {
      // Test import
      const { datalyr } = await import('@datalyr/react-native-sdk');
      console.log('✅ Dynamic import successful');
      setStatus('Import OK');

      // Test initialization
      await datalyr.initialize({
        workspaceId: 'test-workspace',
        debug: true,
      });
      
      console.log('✅ SDK initialized');
      setStatus('SDK Initialized');

    } catch (error) {
      console.error('❌ Test failed:', error);
      setStatus(`Error: ${error.message}`);
      Alert.alert('SDK Test Failed', error.message);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>SDK Test Status: {status}</Text>
    </View>
  );
};

export default TestSDK;
```

## Step 6: Check Dependencies

Verify all dependencies are installed:

```bash
# Check if these are installed
npm list react-native-get-random-values
npm list @react-native-async-storage/async-storage
npm list uuid

# Install if missing
npm install react-native-get-random-values @react-native-async-storage/async-storage uuid
```

## Step 7: Platform-Specific Checks

### iOS
```bash
cd ios && pod install && cd ..
npx react-native run-ios --verbose
```

### Android
```bash
npx react-native run-android --verbose
```

## Step 8: Metro Cache Clear

Clear Metro cache:

```bash
# React Native CLI
npx react-native start --reset-cache

# Expo
expo start --clear
```

## Step 9: Temporary Workaround

If still having issues, try this temporary workaround:

```typescript
import React, { useEffect } from 'react';
import { View, Text } from 'react-native';

const App = () => {
  useEffect(() => {
    // Delay SDK initialization to avoid blocking render
    setTimeout(async () => {
      try {
        const { datalyr } = await import('@datalyr/react-native-sdk');
        await datalyr.initialize({
          workspaceId: 'your-workspace-id',
          debug: true,
        });
        console.log('✅ SDK initialized with delay');
      } catch (error) {
        console.error('❌ SDK error (non-blocking):', error);
      }
    }, 1000);
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>App is working!</Text>
    </View>
  );
};

export default App;
```

## Step 10: Check Package.json

Verify your package.json has the correct version:

```json
{
  "dependencies": {
    "@datalyr/react-native-sdk": "^1.0.3"
  }
}
``` 