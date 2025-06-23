import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
  AppState,
  SafeAreaView,
} from 'react-native';
import { datalyr } from '@datalyr/react-native-sdk';

// This example demonstrates all automatic events (like Mixpanel)
export default function AutoEventsExample() {
  const [sdkStatus, setSdkStatus] = useState<any>(null);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [autoEvents, setAutoEvents] = useState<string[]>([]);

  useEffect(() => {
    initializeSDK();
    
    // Monitor app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => subscription?.remove();
  }, []);

  const initializeSDK = async () => {
    try {
      console.log('🚀 Initializing Datalyr SDK with auto-events...');
      
      await datalyr.initialize({
        workspaceId: 'your-workspace-id',
        debug: true,
        autoEvents: {
          trackSessions: true,          // ✅ Automatic session tracking
          trackScreenViews: true,       // ✅ Automatic screen tracking  
          trackAppUpdates: true,        // ✅ App version changes
          trackPerformance: true,       // ✅ App launch time, performance
          sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
        },
      });

      // Get SDK status
      const status = datalyr.getStatus();
      setSdkStatus(status);

      // Get session info
      const session = datalyr.getCurrentSession();
      setSessionInfo(session);

      console.log('✅ SDK initialized with auto-events');
      addAutoEvent('✅ SDK Initialized (automatic)');
      addAutoEvent('📱 App Install Detected (automatic)');
      addAutoEvent('⏱️ Session Started (automatic)');
      addAutoEvent('🚀 App Launch Performance Tracked (automatic)');

    } catch (error) {
      console.error('❌ Failed to initialize SDK:', error);
      Alert.alert('Error', 'Failed to initialize SDK');
    }
  };

  const addAutoEvent = (event: string) => {
    setAutoEvents(prev => [...prev, `${new Date().toLocaleTimeString()}: ${event}`]);
  };

  const handleAppStateChange = (nextAppState: string) => {
    console.log('📱 App state changed to:', nextAppState);
    
    if (nextAppState === 'active') {
      addAutoEvent('🔆 App Foreground (automatic)');
      // Session might be resumed or new session started automatically
      updateSessionInfo();
    } else if (nextAppState === 'background') {
      addAutoEvent('🌙 App Background (automatic)');
    }
  };

  const updateSessionInfo = () => {
    const session = datalyr.getCurrentSession();
    setSessionInfo(session);
  };

  // Simulate automatic screen tracking
  const navigateToScreen = async (screenName: string) => {
    console.log(`📺 Navigating to ${screenName}`);
    
    // This will trigger automatic screen tracking
    await datalyr.screen(screenName, {
      screen_category: 'demo',
      navigation_method: 'button_press',
    });
    
    addAutoEvent(`📺 Pageview: ${screenName} (automatic)`);
    updateSessionInfo();
  };

  // Simulate automatic revenue tracking
  const simulatePurchase = async () => {
    console.log('💰 Simulating purchase...');
    
    // This will trigger automatic revenue event tracking
    await datalyr.trackRevenue('purchase', {
      product_id: 'premium_plan',
      price: 9.99,
      currency: 'USD',
      payment_method: 'apple_pay',
    });
    
    addAutoEvent('💰 Revenue Event: Purchase (automatic)');
  };

  // Simulate app update
  const simulateAppUpdate = async () => {
    console.log('📱 Simulating app update...');
    
    await datalyr.trackAppUpdate('1.0.0', '1.1.0');
    addAutoEvent('📱 App Update: 1.0.0 → 1.1.0 (automatic)');
  };

  // Force end session to test session management
  const endCurrentSession = async () => {
    console.log('🔚 Ending current session...');
    
    await datalyr.endSession();
    addAutoEvent('🔚 Session Ended (manual)');
    
    // Update session info after ending
    setTimeout(updateSessionInfo, 1000);
  };

  // Custom event (for comparison with automatic events)
  const trackCustomEvent = async () => {
    console.log('🎯 Tracking custom event...');
    
    await datalyr.track('button_clicked', {
      button_name: 'custom_event_button',
      screen_name: 'auto_events_demo',
      user_intent: 'testing',
    });
    
    addAutoEvent('🎯 Custom Event: button_clicked (manual)');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.content}>
        <Text style={styles.title}>📊 Datalyr Auto-Events Demo</Text>
        <Text style={styles.subtitle}>Like Mixpanel's Automatic Events</Text>

        {/* SDK Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📱 SDK Status</Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              Initialized: {sdkStatus?.initialized ? '✅' : '❌'}
            </Text>
            <Text style={styles.infoText}>
              Visitor ID: {sdkStatus?.visitorId || 'Not set'}
            </Text>
            <Text style={styles.infoText}>
              Workspace: {sdkStatus?.workspaceId || 'Not set'}
            </Text>
          </View>
        </View>

        {/* Session Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⏱️ Current Session</Text>
          <View style={styles.infoCard}>
            {sessionInfo ? (
              <>
                <Text style={styles.infoText}>
                  Session ID: {sessionInfo.sessionId}
                </Text>
                <Text style={styles.infoText}>
                  Duration: {Math.round((Date.now() - sessionInfo.startTime) / 1000)}s
                </Text>
                <Text style={styles.infoText}>
                  Pageviews: {sessionInfo.screenViews}
                </Text>
                <Text style={styles.infoText}>
                  Events: {sessionInfo.events}
                </Text>
              </>
            ) : (
              <Text style={styles.infoText}>No active session</Text>
            )}
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎮 Test Automatic Events</Text>
          
          <TouchableOpacity 
            style={styles.button} 
            onPress={() => navigateToScreen('Home')}
          >
            <Text style={styles.buttonText}>📺 Navigate to Home</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.button} 
            onPress={() => navigateToScreen('Profile')}
          >
            <Text style={styles.buttonText}>📺 Navigate to Profile</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.button} 
            onPress={() => navigateToScreen('Settings')}
          >
            <Text style={styles.buttonText}>📺 Navigate to Settings</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.button, styles.revenueButton]} 
            onPress={simulatePurchase}
          >
            <Text style={styles.buttonText}>💰 Simulate Purchase</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.button, styles.updateButton]} 
            onPress={simulateAppUpdate}
          >
            <Text style={styles.buttonText}>📱 Simulate App Update</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.button, styles.sessionButton]} 
            onPress={endCurrentSession}
          >
            <Text style={styles.buttonText}>🔚 End Session</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.button, styles.customButton]} 
            onPress={trackCustomEvent}
          >
            <Text style={styles.buttonText}>🎯 Track Custom Event</Text>
          </TouchableOpacity>
        </View>

        {/* Event Log */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📝 Automatic Events Log</Text>
          <View style={styles.eventLog}>
            {autoEvents.length === 0 ? (
              <Text style={styles.noEvents}>No events yet...</Text>
            ) : (
              autoEvents.map((event, index) => (
                <Text key={index} style={styles.eventItem}>
                  {event}
                </Text>
              ))
            )}
          </View>
        </View>

        {/* Auto-Events Features */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>✨ Included Automatic Events</Text>
          <View style={styles.featureList}>
            <Text style={styles.featureItem}>✅ Session Start/End</Text>
            <Text style={styles.featureItem}>✅ App Foreground/Background</Text>
            <Text style={styles.featureItem}>✅ Pageviews</Text>
            <Text style={styles.featureItem}>✅ App Install Detection</Text>
            <Text style={styles.featureItem}>✅ App Updates</Text>
            <Text style={styles.featureItem}>✅ App Launch Performance</Text>
            <Text style={styles.featureItem}>✅ Revenue Events</Text>
            <Text style={styles.featureItem}>✅ SDK Initialization</Text>
            <Text style={styles.featureItem}>✅ Attribution Tracking</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            🎉 All events are automatically captured and sent to your dashboard!
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: '#666',
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  infoCard: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  infoText: {
    fontSize: 14,
    marginBottom: 6,
    color: '#444',
    fontFamily: 'Monaco',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  revenueButton: {
    backgroundColor: '#34C759',
  },
  updateButton: {
    backgroundColor: '#FF9500',
  },
  sessionButton: {
    backgroundColor: '#FF3B30',
  },
  customButton: {
    backgroundColor: '#5856D6',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  eventLog: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    maxHeight: 200,
  },
  noEvents: {
    textAlign: 'center',
    color: '#999',
    fontStyle: 'italic',
  },
  eventItem: {
    fontSize: 12,
    marginBottom: 6,
    color: '#333',
    fontFamily: 'Monaco',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 4,
  },
  featureList: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
  },
  featureItem: {
    fontSize: 14,
    marginBottom: 8,
    color: '#333',
  },
  footer: {
    marginTop: 20,
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 8,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 16,
    color: '#34C759',
    fontWeight: '600',
    textAlign: 'center',
  },
}); 