/**
 * Datalyr React Native SDK Example
 * 
 * This example shows how to integrate the Datalyr SDK into a React Native app
 * for mobile attribution and event tracking.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Button,
  StyleSheet,
  Alert,
  ScrollView,
  StatusBar,
} from 'react-native';
import { datalyr } from '@datalyr/react-native-sdk';

const App: React.FC = () => {
  const [sdkStatus, setSdkStatus] = useState<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    initializeDatalyr();
  }, []);

  const initializeDatalyr = async () => {
    try {
      // Initialize with your workspace ID and API key
      await datalyr.initialize({
        workspaceId: 'ozLZblQ8hN', // Replace with your actual workspace ID
        apiKey: 'dk_your_api_key', // Required for authentication
        debug: true, // Enable debug logging
        enableAttribution: true, // ✅ Deep link attribution tracking
      });
      
      setIsInitialized(true);
      updateStatus();
      
      // Track app launch
      await datalyr.track('app_launch', {
        app_version: '1.0.0',
        platform: 'ios', // or 'android'
      });
      
      console.log('Datalyr SDK initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize Datalyr SDK:', error);
      Alert.alert('Error', 'Failed to initialize Datalyr SDK');
    }
  };

  const updateStatus = () => {
    const status = datalyr.getStatus();
    setSdkStatus(status);
  };

  const trackPurchase = async () => {
    try {
      await datalyr.track('purchase', {
        value: 29.99,
        currency: 'USD',
        item_id: 'product_123',
        item_name: 'Premium Subscription',
        category: 'subscription',
      });
      
      Alert.alert('Success', 'Purchase event tracked!');
      updateStatus();
    } catch (error) {
      console.error('Error tracking purchase:', error);
      Alert.alert('Error', 'Failed to track purchase');
    }
  };

  const trackScreenView = async () => {
    try {
      await datalyr.screen('home_screen', {
        section: 'main',
        user_type: 'premium',
      });
      
      Alert.alert('Success', 'Pageview tracked!');
      updateStatus();
    } catch (error) {
      console.error('Error tracking pageview:', error);
      Alert.alert('Error', 'Failed to track pageview');
    }
  };

  const identifyUser = async () => {
    try {
      await datalyr.identify('user_12345', {
        email: 'user@example.com',
        name: 'John Doe',
        plan: 'premium',
        signup_date: new Date().toISOString(),
      });
      
      Alert.alert('Success', 'User identified!');
      updateStatus();
    } catch (error) {
      console.error('Error identifying user:', error);
      Alert.alert('Error', 'Failed to identify user');
    }
  };

  const flushEvents = async () => {
    try {
      await datalyr.flush();
      Alert.alert('Success', 'Events flushed!');
      updateStatus();
    } catch (error) {
      console.error('Error flushing events:', error);
      Alert.alert('Error', 'Failed to flush events');
    }
  };

  const resetUser = async () => {
    try {
      await datalyr.reset();
      Alert.alert('Success', 'User data reset!');
      updateStatus();
    } catch (error) {
      console.error('Error resetting user:', error);
      Alert.alert('Error', 'Failed to reset user');
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Datalyr SDK Example</Text>
        
        <View style={styles.statusContainer}>
          <Text style={styles.statusTitle}>SDK Status:</Text>
          <Text style={styles.statusText}>
            Initialized: {isInitialized ? '✅' : '❌'}
          </Text>
          {sdkStatus && (
            <>
              <Text style={styles.statusText}>
                Workspace: {sdkStatus.workspaceId}
              </Text>
              <Text style={styles.statusText}>
                Visitor ID: {sdkStatus.visitorId.substring(0, 8)}...
              </Text>
              <Text style={styles.statusText}>
                Session ID: {sdkStatus.sessionId.substring(0, 12)}...
              </Text>
              <Text style={styles.statusText}>
                User ID: {sdkStatus.currentUserId || 'Not set'}
              </Text>
              <Text style={styles.statusText}>
                Queue Size: {sdkStatus.queueStats?.queueSize || 0}
              </Text>
            </>
          )}
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Track Purchase Event"
            onPress={trackPurchase}
            disabled={!isInitialized}
          />
          
          <Button
            title="Track Pageview"
            onPress={trackScreenView}
            disabled={!isInitialized}
          />
          
          <Button
            title="Identify User"
            onPress={identifyUser}
            disabled={!isInitialized}
          />
          
          <Button
            title="Flush Events"
            onPress={flushEvents}
            disabled={!isInitialized}
          />
          
          <Button
            title="Reset User Data"
            onPress={resetUser}
            disabled={!isInitialized}
          />
          
          <Button
            title="Refresh Status"
            onPress={updateStatus}
            disabled={!isInitialized}
          />
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: '#333',
  },
  statusContainer: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  statusText: {
    fontSize: 14,
    marginBottom: 5,
    color: '#666',
    fontFamily: 'monospace',
  },
  buttonContainer: {
    gap: 10,
  },
});

export default App; 