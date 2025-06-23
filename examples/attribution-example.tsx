/**
 * Datalyr Attribution Example
 * 
 * This example shows how to implement and test deep link attribution
 * for Facebook, TikTok, Google Ads, and other ad platforms.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Button,
  StyleSheet,
  Alert,
  ScrollView,
  TextInput,
  Linking,
} from 'react-native';
import Datalyr from '@datalyr/react-native-sdk';

const AttributionExample: React.FC = () => {
  const [attributionData, setAttributionData] = useState<any>(null);
  const [testUrl, setTestUrl] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    initializeSDK();
  }, []);

  const initializeSDK = async () => {
    try {
      await Datalyr.initialize({
        workspaceId: 'ozLZblQ8hN',
        debug: true,
      });
      
      setIsInitialized(true);
      refreshAttributionData();
      
      console.log('Datalyr SDK initialized with attribution tracking!');
    } catch (error) {
      console.error('Failed to initialize SDK:', error);
    }
  };

  const refreshAttributionData = () => {
    if (isInitialized) {
      const data = Datalyr.getAttributionData();
      const status = Datalyr.getStatus();
      setAttributionData({
        ...data,
        summary: status.attribution,
      });
    }
  };

  const testDeepLink = async (url: string) => {
    try {
      console.log('Testing deep link:', url);
      
      // Simulate opening the app with a deep link
      // In a real app, this would happen automatically when the app is opened
      await Linking.openURL(url);
      
      // Refresh attribution data to see if parameters were captured
      setTimeout(() => {
        refreshAttributionData();
        Alert.alert('Deep Link Tested', 'Check attribution data for captured parameters');
      }, 1000);
      
    } catch (error) {
      console.error('Error testing deep link:', error);
      Alert.alert('Error', 'Failed to test deep link');
    }
  };

  const simulateInstall = async () => {
    try {
      // Clear existing attribution data to simulate fresh install
      await Datalyr.setAttributionData({});
      
      Alert.alert(
        'Install Simulation', 
        'Attribution data cleared. The next app launch will be treated as an install.',
        [
          { text: 'OK', onPress: refreshAttributionData }
        ]
      );
    } catch (error) {
      console.error('Error simulating install:', error);
    }
  };

  const setCustomAttribution = async () => {
    try {
      await Datalyr.setAttributionData({
        campaign_source: 'facebook',
        campaign_medium: 'paid_social',
        campaign_name: 'summer_sale_2024',
        fbclid: 'test_fbclid_123456',
        custom_param: 'test_value',
      });
      
      refreshAttributionData();
      Alert.alert('Success', 'Custom attribution data set');
    } catch (error) {
      console.error('Error setting custom attribution:', error);
    }
  };

  // Sample test URLs for different platforms
  const testUrls = {
    // Datalyr LYR System (YOUR MAIN TRACKING!)
    lyr_campaign: 'myapp://open?lyr=summer_sale_mobile&utm_source=facebook&utm_medium=paid_social&utm_campaign=summer_sale&fbclid=IwAR123abc',
    
    // Facebook Attribution
    facebook: 'myapp://open?utm_source=facebook&utm_medium=paid_social&utm_campaign=summer_sale&fbclid=IwAR123abc&lyr=fb_summer_2024',
    
    // TikTok Attribution
    tiktok: 'myapp://open?utm_source=tiktok&utm_medium=video&utm_campaign=viral_video&ttclid=tiktok123xyz&lyr=tt_viral_campaign',
    
    // Google Attribution
    google: 'myapp://open?utm_source=google&utm_medium=search&utm_campaign=brand_search&gclid=google456def&lyr=google_brand_search',
    
    // Partner/Affiliate
    partner: 'myapp://open?utm_source=partner&partner_id=partner123&affiliate_id=aff456&lyr=partner_campaign_q4',
    
    // Complete attribution example
    comprehensive: 'myapp://open?lyr=comprehensive_test&utm_source=facebook&utm_medium=paid_social&utm_campaign=q4_sale&utm_term=mobile_app&utm_content=video_ad&fbclid=IwAR123abc&campaign_id=camp123&ad_id=ad456&creative_id=cr789&placement_id=pl001',
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Attribution Testing</Text>
        
        {/* Attribution Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attribution Status</Text>
          {attributionData ? (
            <View style={styles.dataContainer}>
              <Text style={styles.dataLabel}>Install Status:</Text>
              <Text style={styles.dataValue}>
                {attributionData.summary?.isInstall ? '🆕 First Install' : '🔄 Returning User'}
              </Text>
              
              <Text style={styles.dataLabel}>Attribution Source:</Text>
              <Text style={styles.dataValue}>
                {attributionData.campaign_source || 'Unknown'}
              </Text>
              
              <Text style={styles.dataLabel}>Campaign:</Text>
              <Text style={styles.dataValue}>
                {attributionData.campaign_name || 'Unknown'}
              </Text>
              
              <Text style={styles.dataLabel}>LYR Tag:</Text>
              <Text style={styles.dataValue}>
                {attributionData.lyr || 'Not set'}
              </Text>
              
              <Text style={styles.dataLabel}>Click IDs:</Text>
              {attributionData.fbclid && (
                <Text style={styles.dataValue}>Facebook: {attributionData.fbclid}</Text>
              )}
              {attributionData.ttclid && (
                <Text style={styles.dataValue}>TikTok: {attributionData.ttclid}</Text>
              )}
              {attributionData.gclid && (
                <Text style={styles.dataValue}>Google: {attributionData.gclid}</Text>
              )}
              
              <Text style={styles.dataLabel}>Install Time:</Text>
              <Text style={styles.dataValue}>
                {attributionData.install_time ? 
                  new Date(attributionData.install_time).toLocaleString() : 
                  'Not set'
                }
              </Text>
            </View>
          ) : (
            <Text style={styles.noData}>No attribution data available</Text>
          )}
        </View>

        {/* Test Deep Links */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Attribution Links</Text>
          
          <Button
            title="Test Facebook Attribution"
            onPress={() => testDeepLink(testUrls.facebook)}
            disabled={!isInitialized}
          />
          
          <Button
            title="Test TikTok Attribution"
            onPress={() => testDeepLink(testUrls.tiktok)}
            disabled={!isInitialized}
          />
          
          <Button
            title="Test Google Attribution"
            onPress={() => testDeepLink(testUrls.google)}
            disabled={!isInitialized}
          />
          
          <Button
            title="Test LYR Campaign"
            onPress={() => testDeepLink(testUrls.lyr_campaign)}
            disabled={!isInitialized}
          />
          
          <Button
            title="Test Partner Attribution"
            onPress={() => testDeepLink(testUrls.partner)}
            disabled={!isInitialized}
          />
          
          <Button
            title="Test Comprehensive Attribution"
            onPress={() => testDeepLink(testUrls.comprehensive)}
            disabled={!isInitialized}
          />
        </View>

        {/* Custom URL Testing */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Custom URL</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter deep link URL to test..."
            value={testUrl}
            onChangeText={setTestUrl}
            multiline
          />
          <Button
            title="Test Custom URL"
            onPress={() => testDeepLink(testUrl)}
            disabled={!isInitialized || !testUrl}
          />
        </View>

        {/* Controls */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Controls</Text>
          
          <Button
            title="Refresh Attribution Data"
            onPress={refreshAttributionData}
            disabled={!isInitialized}
          />
          
          <Button
            title="Set Custom Attribution"
            onPress={setCustomAttribution}
            disabled={!isInitialized}
          />
          
          <Button
            title="Simulate Fresh Install"
            onPress={simulateInstall}
            disabled={!isInitialized}
          />
        </View>

        {/* Attribution Flow Explanation */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How It Works</Text>
          <Text style={styles.explanation}>
            1. User clicks ad with attribution parameters (fbclid, ttclid, etc.)
            {'\n'}2. App store opens with deep link containing parameters
            {'\n'}3. User downloads and opens app
            {'\n'}4. SDK captures parameters from deep link
            {'\n'}5. Install event is tracked with attribution data
            {'\n'}6. Future events include attribution for postbacks
          </Text>
        </View>

        {/* Debug Info */}
        {__DEV__ && attributionData && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Debug Info</Text>
            <Text style={styles.debugText}>
              {JSON.stringify(attributionData, null, 2)}
            </Text>
          </View>
        )}
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
  section: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  dataContainer: {
    gap: 5,
  },
  dataLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginTop: 8,
  },
  dataValue: {
    fontSize: 14,
    color: '#333',
    fontFamily: 'monospace',
    backgroundColor: '#f8f8f8',
    padding: 4,
    borderRadius: 4,
  },
  noData: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  explanation: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  debugText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#333',
    backgroundColor: '#f8f8f8',
    padding: 8,
    borderRadius: 4,
  },
});

export default AttributionExample; 