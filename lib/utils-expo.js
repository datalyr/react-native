import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import * as TrackingTransparency from 'expo-tracking-transparency';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
// Storage keys
export const STORAGE_KEYS = {
    VISITOR_ID: '@datalyr/visitor_id',
    SESSION_ID: '@datalyr/session_id',
    SESSION_START: '@datalyr/session_start',
    USER_ID: '@datalyr/user_id',
    USER_PROPERTIES: '@datalyr/user_properties',
    ATTRIBUTION_DATA: '@datalyr/attribution_data',
    INSTALL_TIME: '@datalyr/install_time',
    LAST_APP_VERSION: '@datalyr/last_app_version',
    DEVICE_ID: '@datalyr/device_id',
};
// Debug logging
export const debugLog = (message, ...args) => {
    if (__DEV__) {
        console.log(`[Datalyr] ${message}`, ...args);
    }
};
export const errorLog = (message, error) => {
    console.error(`[Datalyr Error] ${message}`, error);
};
// UUID generation
export const generateUUID = () => {
    return uuidv4();
};
// Storage utilities
export const Storage = {
    async getItem(key) {
        try {
            const value = await AsyncStorage.getItem(key);
            return value ? JSON.parse(value) : null;
        }
        catch (error) {
            errorLog(`Failed to get storage item ${key}:`, error);
            return null;
        }
    },
    async setItem(key, value) {
        try {
            await AsyncStorage.setItem(key, JSON.stringify(value));
        }
        catch (error) {
            errorLog(`Failed to set storage item ${key}:`, error);
        }
    },
    async removeItem(key) {
        try {
            await AsyncStorage.removeItem(key);
        }
        catch (error) {
            errorLog(`Failed to remove storage item ${key}:`, error);
        }
    },
};
export const getDeviceInfo = async () => {
    try {
        const deviceId = await getOrCreateDeviceId();
        return {
            deviceId,
            model: Device.modelName || Device.deviceName || 'Unknown',
            manufacturer: Device.manufacturer || (Platform.OS === 'ios' ? 'Apple' : 'Unknown'),
            osVersion: Device.osVersion || 'Unknown',
            appVersion: Application.nativeApplicationVersion || '1.0.0',
            buildNumber: Application.nativeBuildVersion || '1',
            bundleId: Application.applicationId || 'unknown.bundle.id',
            screenWidth: 0, // Would need Dimensions from react-native
            screenHeight: 0, // Would need Dimensions from react-native  
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: 'en-US', // Would need expo-localization for full locale
            carrier: undefined, // Not available in Expo managed workflow
            isEmulator: !Device.isDevice,
        };
    }
    catch (error) {
        errorLog('Error getting device info:', error);
        return {
            deviceId: await getOrCreateDeviceId(),
            model: 'Unknown',
            manufacturer: Platform.OS === 'ios' ? 'Apple' : 'Unknown',
            osVersion: 'Unknown',
            appVersion: '1.0.0',
            buildNumber: '1',
            bundleId: 'unknown.bundle.id',
            screenWidth: 0,
            screenHeight: 0,
            timezone: 'UTC',
            locale: 'en-US',
            isEmulator: true,
        };
    }
};
// Device ID management
const getOrCreateDeviceId = async () => {
    try {
        let deviceId = await Storage.getItem(STORAGE_KEYS.DEVICE_ID);
        if (!deviceId) {
            deviceId = generateUUID();
            await Storage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
        }
        return deviceId;
    }
    catch (error) {
        errorLog('Error managing device ID:', error);
        return generateUUID();
    }
};
// Visitor ID management  
export const getOrCreateVisitorId = async () => {
    try {
        let visitorId = await Storage.getItem(STORAGE_KEYS.VISITOR_ID);
        if (!visitorId) {
            visitorId = generateUUID();
            await Storage.setItem(STORAGE_KEYS.VISITOR_ID, visitorId);
            debugLog('Created new visitor ID:', visitorId);
        }
        return visitorId;
    }
    catch (error) {
        errorLog('Error managing visitor ID:', error);
        return generateUUID();
    }
};
// Session management
export const getOrCreateSessionId = async () => {
    try {
        const sessionTimeout = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();
        const [sessionId, sessionStart] = await Promise.all([
            Storage.getItem(STORAGE_KEYS.SESSION_ID),
            Storage.getItem(STORAGE_KEYS.SESSION_START),
        ]);
        // Check if session is still valid
        if (sessionId && sessionStart && (now - sessionStart) < sessionTimeout) {
            return sessionId;
        }
        // Create new session
        const newSessionId = generateUUID();
        await Promise.all([
            Storage.setItem(STORAGE_KEYS.SESSION_ID, newSessionId),
            Storage.setItem(STORAGE_KEYS.SESSION_START, now),
        ]);
        debugLog('Created new session:', newSessionId);
        return newSessionId;
    }
    catch (error) {
        errorLog('Error managing session ID:', error);
        return generateUUID();
    }
};
// Fingerprint data creation using Expo APIs
export const createFingerprintData = async () => {
    try {
        const deviceInfo = await getDeviceInfo();
        // Try to get IDFA/GAID with proper permission handling
        let advertisingId;
        if (Platform.OS === 'ios') {
            try {
                const { status } = await TrackingTransparency.requestTrackingPermissionsAsync();
                if (status === TrackingTransparency.PermissionStatus.GRANTED) {
                    // Note: expo-tracking-transparency doesn't directly provide IDFA
                    // You would need additional setup or use expo-ads-admob
                    advertisingId = await getIDFA();
                }
                else {
                    debugLog('IDFA permission denied or restricted');
                }
            }
            catch (error) {
                debugLog('Error requesting tracking permission:', error);
            }
        }
        else {
            // For Android, would need additional setup for GAID
            advertisingId = await getGAID();
        }
        return {
            deviceId: deviceInfo.deviceId,
            advertisingId,
            deviceInfo: {
                model: deviceInfo.model,
                manufacturer: deviceInfo.manufacturer,
                osVersion: deviceInfo.osVersion,
                screenSize: `${deviceInfo.screenWidth}x${deviceInfo.screenHeight}`,
                timezone: deviceInfo.timezone,
                locale: deviceInfo.locale,
                carrier: deviceInfo.carrier,
                isEmulator: deviceInfo.isEmulator,
            },
        };
    }
    catch (error) {
        errorLog('Error creating fingerprint data:', error);
        const deviceInfo = await getDeviceInfo();
        return {
            deviceId: deviceInfo.deviceId,
            deviceInfo: {
                model: deviceInfo.model,
                manufacturer: deviceInfo.manufacturer,
                osVersion: deviceInfo.osVersion,
                screenSize: '0x0',
                timezone: deviceInfo.timezone,
                locale: deviceInfo.locale,
                isEmulator: deviceInfo.isEmulator,
            },
        };
    }
};
// Placeholder functions for IDFA/GAID (would need additional Expo setup)
const getIDFA = async () => {
    // In a real Expo app, you might use:
    // - expo-ads-admob for advertising ID
    // - or implement a custom native module
    // For now, return undefined as it requires additional setup
    return undefined;
};
const getGAID = async () => {
    // In a real Expo app, you would use expo-ads-admob or similar
    // For now, return undefined as it requires additional setup  
    return undefined;
};
// Network type detection using Expo Network
export const getNetworkType = async () => {
    try {
        const networkState = await Network.getNetworkStateAsync();
        if (!networkState.isConnected) {
            return 'none';
        }
        switch (networkState.type) {
            case Network.NetworkStateType.WIFI:
                return 'wifi';
            case Network.NetworkStateType.CELLULAR:
                return 'cellular';
            case Network.NetworkStateType.ETHERNET:
                return 'ethernet';
            case Network.NetworkStateType.BLUETOOTH:
                return 'bluetooth';
            default:
                return 'unknown';
        }
    }
    catch (error) {
        debugLog('Error getting network type:', error);
        return 'unknown';
    }
};
// Event validation
export const validateEventName = (eventName) => {
    if (!eventName || typeof eventName !== 'string') {
        return false;
    }
    if (eventName.length > 100) {
        return false;
    }
    // Allow letters, numbers, underscores, and hyphens
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    return validPattern.test(eventName);
};
export const validateEventData = (eventData) => {
    if (!eventData) {
        return true;
    }
    if (typeof eventData !== 'object' || Array.isArray(eventData)) {
        return false;
    }
    try {
        // Check if data can be serialized
        JSON.stringify(eventData);
        return true;
    }
    catch (_a) {
        return false;
    }
};
// Install detection
export const isFirstLaunch = async () => {
    try {
        const installTime = await Storage.getItem(STORAGE_KEYS.INSTALL_TIME);
        if (!installTime) {
            // First launch - record install time
            await Storage.setItem(STORAGE_KEYS.INSTALL_TIME, new Date().toISOString());
            return true;
        }
        return false;
    }
    catch (error) {
        errorLog('Error checking first launch:', error);
        return false;
    }
};
// App version tracking
export const checkAppVersion = async () => {
    try {
        const currentVersion = Application.nativeApplicationVersion || '1.0.0';
        const currentBuild = Application.nativeBuildVersion || '1';
        const versionString = `${currentVersion}-${currentBuild}`;
        const lastVersion = await Storage.getItem(STORAGE_KEYS.LAST_APP_VERSION);
        if (lastVersion && lastVersion !== versionString) {
            await Storage.setItem(STORAGE_KEYS.LAST_APP_VERSION, versionString);
            return {
                isUpdate: true,
                previousVersion: lastVersion,
                currentVersion: versionString,
            };
        }
        if (!lastVersion) {
            await Storage.setItem(STORAGE_KEYS.LAST_APP_VERSION, versionString);
        }
        return {
            isUpdate: false,
            currentVersion: versionString,
        };
    }
    catch (error) {
        errorLog('Error checking app version:', error);
        return {
            isUpdate: false,
            currentVersion: '1.0.0-1',
        };
    }
};
