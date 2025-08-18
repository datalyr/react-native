import React, { useEffect } from 'react';
import { Button, View, Text, StyleSheet } from 'react-native';
import { Datalyr } from '@datalyr/react-native';

// Initialize SDK with server-side API
const initializeSDK = async () => {
  await Datalyr.initialize({
    apiKey: 'dk_your_api_key_here', // Required for v1.0.0
    // workspaceId is now optional
    useServerTracking: true, // Default: true (uses https://api.datalyr.com)
    debug: true,
    enableAutoEvents: true,
    enableAttribution: true,
    skadTemplate: 'ecommerce', // For SKAdNetwork support
  });
  
  console.log('Datalyr SDK initialized with server-side tracking');
};

export default function TestApp() {
  useEffect(() => {
    initializeSDK();
    
    // Track app open event
    Datalyr.track('App Opened', {
      version: '1.0.0',
      source: 'test_implementation',
    });
  }, []);

  const testUserIdentification = async () => {
    await Datalyr.identify('test_user_123', {
      email: 'user@example.com',
      name: 'Test User',
      plan: 'premium',
      company: 'Test Company',
    });
    console.log('User identified');
  };

  const testEventTracking = async () => {
    // Standard event tracking
    await Datalyr.track('Button Clicked', {
      button_name: 'test_button',
      screen: 'test_screen',
    });
    
    console.log('Event tracked');
  };

  const testPurchaseTracking = async () => {
    // Track purchase with automatic SKAdNetwork conversion
    await Datalyr.trackPurchase(99.99, 'USD', 'premium_subscription');
    console.log('Purchase tracked with SKAdNetwork');
  };

  const testScreenTracking = async () => {
    await Datalyr.screen('Test Screen', {
      previous_screen: 'Home',
      user_action: 'navigation',
    });
    console.log('Screen view tracked');
  };

  const testAttributionData = async () => {
    // Set custom attribution data
    await Datalyr.setAttributionData({
      campaign: 'summer_sale',
      source: 'facebook',
      medium: 'social',
      fbclid: 'test_fbclid_123',
    });
    
    // Get current attribution
    const attribution = Datalyr.getAttributionData();
    console.log('Attribution data:', attribution);
  };

  const testSessionManagement = async () => {
    // Get current session
    const session = Datalyr.getCurrentSession();
    console.log('Current session:', session);
    
    // End session manually if needed
    await Datalyr.endSession();
    console.log('Session ended');
  };

  const testRevenue = async () => {
    // Track subscription
    await Datalyr.trackSubscription(49.99, 'USD', 'monthly_pro');
    
    // Track custom revenue event
    await Datalyr.trackRevenue('In-App Purchase', {
      product_id: 'coins_1000',
      amount: 4.99,
      currency: 'USD',
      quantity: 1,
    });
    
    console.log('Revenue events tracked');
  };

  const testFlush = async () => {
    // Force flush all queued events
    await Datalyr.flush();
    console.log('Events flushed');
  };

  const testReset = async () => {
    // Reset user session (logout)
    await Datalyr.reset();
    console.log('User session reset');
  };

  const getStatus = () => {
    const status = Datalyr.getStatus();
    console.log('SDK Status:', status);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Datalyr SDK v1.0.0 Test</Text>
      <Text style={styles.subtitle}>Server-Side Tracking API</Text>
      
      <View style={styles.buttonContainer}>
        <Button title="Identify User" onPress={testUserIdentification} />
        <Button title="Track Event" onPress={testEventTracking} />
        <Button title="Track Purchase" onPress={testPurchaseTracking} />
        <Button title="Track Screen" onPress={testScreenTracking} />
        <Button title="Test Attribution" onPress={testAttributionData} />
        <Button title="Test Session" onPress={testSessionManagement} />
        <Button title="Track Revenue" onPress={testRevenue} />
        <Button title="Flush Events" onPress={testFlush} />
        <Button title="Reset Session" onPress={testReset} />
        <Button title="Get Status" onPress={getStatus} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: '#666',
  },
  buttonContainer: {
    gap: 10,
  },
});