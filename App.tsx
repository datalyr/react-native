import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { datalyr } from '@datalyr/react-native-sdk';

const App: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [sdkStatus, setSdkStatus] = useState<any>(null);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    console.log(message);
  };

  useEffect(() => {
    const initializeSDK = async () => {
      try {
        addLog('🔄 Initializing SDK with API key...');
        
        await datalyr.initialize({
          workspaceId: 'BFXm1IpyVe',
          apiKey: 'dk_KCrEZT9saU4ZlTwr2HHnuaia3jKDHcuf',
          debug: true,
          enableAutoEvents: true,
          enableAttribution: true, // ✅ Deep link attribution tracking
          autoEvents: {
            trackSessions: true,
            trackScreenViews: true,
          }
        });
        
        addLog('✅ SDK initialized successfully with API key');
        setInitialized(true);
        
        // Get SDK status
        const status = datalyr.getStatus();
        setSdkStatus(status);
        addLog(`📊 SDK Status: ${JSON.stringify(status, null, 2)}`);
        
      } catch (error) {
        addLog(`❌ SDK initialization failed: ${error}`);
      }
    };

    initializeSDK();
  }, []);

  const testEvent = async () => {
    try {
      addLog('🧪 Testing event with API key...');
      await datalyr.track('test_event', { 
        test_property: 'test_value',
        timestamp: Date.now(),
        api_key_test: true
      });
      addLog('✅ Test event sent successfully');
    } catch (error) {
      addLog(`❌ Test event failed: ${error}`);
    }
  };

  const testScreen = async () => {
    try {
      addLog('📱 Testing screen/pageview with API key...');
      await datalyr.screen('test_screen', { 
        screen_category: 'test',
        api_key_test: true
      });
      addLog('✅ Screen/pageview sent successfully');
    } catch (error) {
      addLog(`❌ Screen/pageview failed: ${error}`);
    }
  };

  const testIdentify = async () => {
    try {
      addLog('👤 Testing user identification...');
      await datalyr.identify('test_user_123', {
        email: 'test@example.com',
        name: 'Test User',
        api_key_test: true
      });
      addLog('✅ User identification sent successfully');
    } catch (error) {
      addLog(`❌ User identification failed: ${error}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔑 Datalyr SDK API Key Test</Text>
      <Text style={styles.subtitle}>v1.0.10 - Production Ready</Text>
      
      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>
          Status: {initialized ? '✅ Initialized' : '⏳ Initializing...'}
        </Text>
        {sdkStatus && (
          <Text style={styles.statusText}>
            Workspace: {sdkStatus.workspaceId}
          </Text>
        )}
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.button, !initialized && styles.buttonDisabled]} 
          onPress={testEvent}
          disabled={!initialized}
        >
          <Text style={styles.buttonText}>🧪 Test Event</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, !initialized && styles.buttonDisabled]} 
          onPress={testScreen}
          disabled={!initialized}
        >
          <Text style={styles.buttonText}>📱 Test Screen</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, !initialized && styles.buttonDisabled]} 
          onPress={testIdentify}
          disabled={!initialized}
        >
          <Text style={styles.buttonText}>👤 Test Identify</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.logContainer}>
        <Text style={styles.logTitle}>📋 Real-time Logs:</Text>
        {logs.map((log, index) => (
          <Text key={index} style={styles.logText}>
            {log}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    color: '#666',
  },
  statusContainer: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusText: {
    fontSize: 16,
    marginBottom: 5,
    color: '#333',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  logTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  logText: {
    fontSize: 12,
    marginBottom: 5,
    color: '#666',
    fontFamily: 'monospace',
  },
});

export default App; 