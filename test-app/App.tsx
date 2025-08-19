import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { datalyr } from '@datalyr/react-native';

const App: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [sdkStatus, setSdkStatus] = useState<any>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    console.log(message);
  };

  useEffect(() => {
    const initializeSDK = async () => {
      try {
        addLog('🔄 Initializing SDK with API key...');
        
        const config = {
          workspaceId: 'your-workspace-id', // Replace with your workspace ID
          apiKey: 'dk_your_api_key', // Replace with your API key
          debug: true,
          enableAutoEvents: true,
          enableAttribution: true, // Enable deep link parameter tracking
          autoEvents: {
            trackSessions: true,
            trackScreenViews: true,
          }
        };
        
        // Debug: Log the config being passed
        addLog(`🔧 Config object: ${JSON.stringify(config, null, 2)}`);
        addLog(`🔑 API Key present: ${!!config.apiKey}`);
        addLog(`🔑 API Key value: ${config.apiKey}`);
        
        await datalyr.initialize(config);
        
        addLog('✅ SDK initialized successfully with API key');
        
        // Log attribution setup status
        if (config.enableAttribution) {
          addLog('🎯 Attribution enabled - will track:');
          addLog('  • UTM parameters (utm_source, utm_medium, utm_campaign, etc.)');
          addLog('  • Click IDs (fbclid, gclid, ttclid, msclkid)');
          addLog('  • LYR tags (lyr, ref parameters)');
          addLog('  • Deep link install attribution');
        } else {
          addLog('⚠️  Attribution disabled - deep link parameters will NOT be tracked');
        }
        
        setInitialized(true);
        
        // Get SDK status
        const status = datalyr.getStatus();
        setSdkStatus(status);
        addLog(`📊 SDK Status: ${JSON.stringify(status, null, 2)}`);
        
      } catch (error) {
        addLog(`❌ SDK initialization failed: ${error}`);
        addLog(`❌ Error details: ${JSON.stringify(error, null, 2)}`);
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

  const testAttribution = async () => {
    try {
      addLog('🔗 Testing attribution data...');
      const attribution = datalyr.getAttributionData();
      addLog(`📊 Attribution Data: ${JSON.stringify(attribution, null, 2)}`);
    } catch (error) {
      addLog(`❌ Attribution test failed: ${error}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔑 Datalyr SDK API Key Test</Text>
      <Text style={styles.subtitle}>v1.0.11 - Production Ready</Text>
      
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
      </View>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.button, !initialized && styles.buttonDisabled]} 
          onPress={testIdentify}
          disabled={!initialized}
        >
          <Text style={styles.buttonText}>👤 Test Identify</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, !initialized && styles.buttonDisabled]} 
          onPress={testAttribution}
          disabled={!initialized}
        >
          <Text style={styles.buttonText}>🔗 Attribution</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.logAccordion}>
        <TouchableOpacity 
          style={styles.logHeader}
          onPress={() => setLogsExpanded(!logsExpanded)}
        >
          <Text style={styles.logTitle}>
            📋 Real-time Logs ({logs.length}) {logsExpanded ? '▼' : '▶'}
          </Text>
        </TouchableOpacity>
        
        {logsExpanded && (
          <ScrollView style={styles.logContainer}>
            {logs.map((log, index) => (
              <Text key={index} style={styles.logText}>
                {log}
              </Text>
            ))}
          </ScrollView>
        )}
      </View>
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
    justifyContent: 'space-between',
    marginBottom: 15,
    paddingHorizontal: 10,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    flex: 1,
    marginHorizontal: 5,
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
  logAccordion: {
    backgroundColor: '#fff',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    flex: 1,
    marginTop: 10,
  },
  logHeader: {
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  logContainer: {
    maxHeight: 300,
    padding: 18,
    paddingTop: 15,
  },
  logTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  logText: {
    fontSize: 13,
    marginBottom: 8,
    color: '#666',
    fontFamily: 'monospace',
    lineHeight: 18,
    paddingVertical: 2,
  },
});

export default App; 