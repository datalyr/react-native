import 'react-native-get-random-values';
export declare const STORAGE_KEYS: {
    readonly VISITOR_ID: "@datalyr/visitor_id";
    readonly SESSION_ID: "@datalyr/session_id";
    readonly SESSION_START: "@datalyr/session_start";
    readonly USER_ID: "@datalyr/user_id";
    readonly USER_PROPERTIES: "@datalyr/user_properties";
    readonly ATTRIBUTION_DATA: "@datalyr/attribution_data";
    readonly INSTALL_TIME: "@datalyr/install_time";
    readonly LAST_APP_VERSION: "@datalyr/last_app_version";
    readonly DEVICE_ID: "@datalyr/device_id";
};
export declare const debugLog: (message: string, ...args: any[]) => void;
export declare const errorLog: (message: string, error?: Error) => void;
export declare const generateUUID: () => string;
export declare const Storage: {
    getItem<T>(key: string): Promise<T | null>;
    setItem<T>(key: string, value: T): Promise<void>;
    removeItem(key: string): Promise<void>;
};
export interface DeviceInfo {
    deviceId: string;
    model: string;
    manufacturer: string;
    osVersion: string;
    appVersion: string;
    buildNumber: string;
    bundleId: string;
    screenWidth: number;
    screenHeight: number;
    timezone: string;
    locale: string;
    carrier?: string;
    isEmulator: boolean;
}
export declare const getDeviceInfo: () => Promise<DeviceInfo>;
export declare const getOrCreateVisitorId: () => Promise<string>;
export declare const getOrCreateSessionId: () => Promise<string>;
export declare const createFingerprintData: () => Promise<{
    deviceId: string;
    advertisingId: string | undefined;
    deviceInfo: {
        model: string;
        manufacturer: string;
        osVersion: string;
        screenSize: string;
        timezone: string;
        locale: string;
        carrier: string | undefined;
        isEmulator: boolean;
    };
} | {
    deviceId: string;
    deviceInfo: {
        model: string;
        manufacturer: string;
        osVersion: string;
        screenSize: string;
        timezone: string;
        locale: string;
        isEmulator: boolean;
        carrier?: undefined;
    };
    advertisingId?: undefined;
}>;
export declare const getNetworkType: () => Promise<string>;
export declare const validateEventName: (eventName: string) => boolean;
export declare const validateEventData: (eventData?: Record<string, any>) => boolean;
export declare const isFirstLaunch: () => Promise<boolean>;
export declare const checkAppVersion: () => Promise<{
    isUpdate: boolean;
    previousVersion?: string;
    currentVersion: string;
}>;
