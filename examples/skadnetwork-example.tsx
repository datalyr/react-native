import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet, ScrollView, Alert } from 'react-native';
import { Datalyr } from '../src/index';

/**
 * 🚀 SKAdNetwork Example - React Native
 * 
 * This example demonstrates how to use Datalyr's automatic SKAdNetwork conversion value encoding
 * to compete with AppsFlyer/Adjust at 90% cost savings.
 * 
 * Features demonstrated:
 * - Industry template initialization (E-commerce, Gaming, Subscription)
 * - Automatic conversion value encoding for iOS 14+ attribution
 * - Revenue tier optimization (8 tiers: $0-1, $1-5, $5-10, $10-25, $25-50, $50-100, $100-250, $250+)
 * - Event tracking with automatic SKAdNetwork.updateConversionValue() calls
 * - Testing and debugging conversion values
 */

interface TestResult {
  event: string;
  conversionValue: number | null;
  properties?: any;
}

export default function SKAdNetworkExample() {
  const [initialized, setInitialized] = useState(false);
  const [currentTemplate, setCurrentTemplate] = useState<'ecommerce' | 'gaming' | 'subscription'>('ecommerce');
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  useEffect(() => {
    initializeDatalyr();
  }, []);

  // Initialize with E-commerce template
  const initializeDatalyr = async () => {
    try {
      await Datalyr.initialize({
        workspaceId: 'your-workspace-id',
        apiKey: 'dk_your_api_key',
        skadTemplate: 'ecommerce', // Industry template for automatic optimization
        debug: true, // Enable detailed SKAdNetwork logging
        enableAttribution: true,
        autoEvents: {
          trackSessions: true,
          trackScreenViews: true,
        },
      });
      
      setInitialized(true);
      console.log('✅ Datalyr initialized with SKAdNetwork E-commerce template');
      
    } catch (error) {
      console.error('❌ Failed to initialize Datalyr:', error);
      Alert.alert('Error', 'Failed to initialize SDK');
    }
  };

  // Switch between different industry templates
  const switchTemplate = async (template: 'ecommerce' | 'gaming' | 'subscription') => {
    try {
      await Datalyr.initialize({
        workspaceId: 'your-workspace-id',
        apiKey: 'dk_your_api_key',
        skadTemplate: template,
        debug: true,
      });
      setCurrentTemplate(template);
      setTestResults([]);
      console.log(`✅ Switched to ${template} template`);
    } catch (error) {
      console.error(`❌ Failed to switch to ${template} template:`, error);
    }
  };

  // Test conversion value encoding without sending to Apple
  const testConversionValue = (event: string, properties?: any) => {
    const conversionValue = Datalyr.getConversionValue(event, properties);
    const result: TestResult = { event, conversionValue, properties };
    setTestResults(prev => [...prev, result]);
    
    console.log(`🧪 Test - Event: ${event}, Conversion Value: ${conversionValue}`, properties);
    return conversionValue;
  };

  // E-commerce Examples
  const trackEcommerceEvents = async () => {
    console.log('🛒 Tracking E-commerce Events');
    
    // Track purchase with automatic revenue encoding
    await Datalyr.trackPurchase(29.99, 'USD', 'premium_plan');
    testConversionValue('purchase', { revenue: 29.99, currency: 'USD' });
    
    // Track funnel events
    await Datalyr.trackWithSKAdNetwork('view_item', { product_id: 'shirt_001' });
    testConversionValue('view_item', { product_id: 'shirt_001' });
    
    await Datalyr.trackWithSKAdNetwork('add_to_cart', { product_id: 'shirt_001', value: 25.99 });
    testConversionValue('add_to_cart', { product_id: 'shirt_001' });
    
    await Datalyr.trackWithSKAdNetwork('begin_checkout', { cart_value: 89.97 });
    testConversionValue('begin_checkout', { cart_value: 89.97 });
    
    await Datalyr.trackWithSKAdNetwork('signup', { source: 'homepage' });
    testConversionValue('signup', { source: 'homepage' });
    
    Alert.alert('E-commerce Events', 'Tracked purchase, cart events, and signup with automatic SKAdNetwork encoding');
  };

  // Gaming Examples
  const trackGamingEvents = async () => {
    console.log('🎮 Tracking Gaming Events');
    
    // Track game progression
    await Datalyr.trackWithSKAdNetwork('tutorial_complete', { level: 1 });
    testConversionValue('tutorial_complete', { level: 1 });
    
    await Datalyr.trackWithSKAdNetwork('level_complete', { level: 5, score: 1250 });
    testConversionValue('level_complete', { level: 5, score: 1250 });
    
    await Datalyr.trackWithSKAdNetwork('achievement_unlocked', { achievement: 'first_win' });
    testConversionValue('achievement_unlocked', { achievement: 'first_win' });
    
    // Track in-app purchase
    await Datalyr.trackPurchase(4.99, 'USD', 'extra_lives');
    testConversionValue('purchase', { revenue: 4.99, currency: 'USD' });
    
    await Datalyr.trackWithSKAdNetwork('ad_watched', { ad_type: 'rewarded_video' });
    testConversionValue('ad_watched', { ad_type: 'rewarded_video' });
    
    Alert.alert('Gaming Events', 'Tracked game progression and IAP with automatic SKAdNetwork encoding');
  };

  // Subscription Examples
  const trackSubscriptionEvents = async () => {
    console.log('📱 Tracking Subscription Events');
    
    // Track subscription funnel
    await Datalyr.trackWithSKAdNetwork('trial_start', { plan: 'premium' });
    testConversionValue('trial_start', { plan: 'premium' });
    
    await Datalyr.trackSubscription(9.99, 'USD', 'monthly');
    testConversionValue('subscribe', { revenue: 9.99, currency: 'USD' });
    
    await Datalyr.trackWithSKAdNetwork('upgrade', { 
      revenue: 19.99,
      from_plan: 'basic',
      to_plan: 'premium'
    });
    testConversionValue('upgrade', { revenue: 19.99 });
    
    await Datalyr.trackWithSKAdNetwork('payment_method_added', { method: 'credit_card' });
    testConversionValue('payment_method_added', { method: 'credit_card' });
    
    Alert.alert('Subscription Events', 'Tracked subscription funnel with automatic SKAdNetwork encoding');
  };

  // Test different revenue tiers
  const testRevenueTiers = () => {
    console.log('💰 Testing Revenue Tiers');
    
    const testAmounts = [0.5, 2.99, 7.99, 15.99, 35.99, 75.99, 150.99, 299.99];
    testAmounts.forEach(amount => {
      testConversionValue('purchase', { revenue: amount });
    });
    
    Alert.alert('Revenue Tiers', 'Tested all 8 revenue tiers (check console for values)');
  };

  const clearResults = () => {
    setTestResults([]);
  };

  if (!initialized) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Initializing SKAdNetwork...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>🚀 SKAdNetwork Example</Text>
      <Text style={styles.subtitle}>Compete with AppsFlyer/Adjust at 90% cost savings</Text>
      
      {/* Template Selector */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Industry Templates</Text>
        <View style={styles.buttonRow}>
          {(['ecommerce', 'gaming', 'subscription'] as const).map(template => (
            <Button
              key={template}
              title={template.charAt(0).toUpperCase() + template.slice(1)}
              onPress={() => switchTemplate(template)}
              color={currentTemplate === template ? '#007AFF' : '#999'}
            />
          ))}
        </View>
        <Text style={styles.currentTemplate}>Current: {currentTemplate}</Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Track Events ({currentTemplate})</Text>
        
        {currentTemplate === 'ecommerce' && (
          <Button title="🛒 Track E-commerce Events" onPress={trackEcommerceEvents} />
        )}
        
        {currentTemplate === 'gaming' && (
          <Button title="🎮 Track Gaming Events" onPress={trackGamingEvents} />
        )}
        
        {currentTemplate === 'subscription' && (
          <Button title="📱 Track Subscription Events" onPress={trackSubscriptionEvents} />
        )}
        
        <View style={styles.buttonSpacing} />
        <Button title="💰 Test Revenue Tiers" onPress={testRevenueTiers} />
      </View>

      {/* Test Results */}
      <View style={styles.section}>
        <View style={styles.resultHeader}>
          <Text style={styles.sectionTitle}>Conversion Values (Test Mode)</Text>
          <Button title="Clear" onPress={clearResults} />
        </View>
        
        {testResults.length === 0 ? (
          <Text style={styles.noResults}>No test results yet. Track some events!</Text>
        ) : (
          testResults.map((result, index) => (
            <View key={index} style={styles.resultItem}>
              <Text style={styles.resultEvent}>{result.event}</Text>
              <Text style={styles.resultValue}>Value: {result.conversionValue || 0}</Text>
              {result.properties && (
                <Text style={styles.resultProperties}>
                  {JSON.stringify(result.properties, null, 2).slice(0, 100)}...
                </Text>
              )}
            </View>
          ))
        )}
      </View>

      {/* Revenue Tier Reference */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Revenue Tier Reference</Text>
        <View style={styles.tierTable}>
          {[
            ['$0-1', 'Tier 0'],
            ['$1-5', 'Tier 1'],
            ['$5-10', 'Tier 2'],
            ['$10-25', 'Tier 3'],
            ['$25-50', 'Tier 4'],
            ['$50-100', 'Tier 5'],
            ['$100-250', 'Tier 6'],
            ['$250+', 'Tier 7'],
          ].map(([range, tier], index) => (
            <View key={index} style={styles.tierRow}>
              <Text style={styles.tierRange}>{range}</Text>
              <Text style={styles.tierValue}>{tier}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          🎯 Same functionality as AppsFlyer/Adjust{'\n'}
          💰 90% cost savings{'\n'}
          📊 Unified web + mobile dashboard
        </Text>
      </View>
    </ScrollView>
  );
}

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
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    color: '#666',
    marginBottom: 20,
  },
  section: {
    backgroundColor: 'white',
    padding: 15,
    marginBottom: 15,
    borderRadius: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  currentTemplate: {
    textAlign: 'center',
    fontStyle: 'italic',
    color: '#666',
  },
  buttonSpacing: {
    height: 10,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  noResults: {
    textAlign: 'center',
    color: '#999',
    fontStyle: 'italic',
  },
  resultItem: {
    padding: 10,
    backgroundColor: '#f8f8f8',
    marginBottom: 5,
    borderRadius: 5,
  },
  resultEvent: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  resultValue: {
    color: '#007AFF',
    fontSize: 14,
  },
  resultProperties: {
    color: '#666',
    fontSize: 12,
    marginTop: 5,
  },
  tierTable: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
  },
  tierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tierRange: {
    fontWeight: 'bold',
  },
  tierValue: {
    color: '#666',
  },
  footer: {
    padding: 15,
    backgroundColor: '#e8f4f8',
    borderRadius: 10,
    marginBottom: 20,
  },
  footerText: {
    textAlign: 'center',
    color: '#666',
    lineHeight: 20,
  },
}); 