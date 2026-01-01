export interface AutoEventConfig {
    trackSessions?: boolean;
    trackScreenViews?: boolean;
    trackAppUpdates?: boolean;
    trackPerformance?: boolean;
    sessionTimeoutMs?: number;
}
export interface MetaConfig {
    appId: string;
    clientToken?: string;
    enableDeferredDeepLink?: boolean;
    enableAppEvents?: boolean;
    advertiserTrackingEnabled?: boolean;
}
export interface TikTokConfig {
    appId: string;
    tiktokAppId: string;
    accessToken?: string;
    enableAppEvents?: boolean;
}
export interface DeferredDeepLinkResult {
    url?: string;
    source?: string;
    fbclid?: string;
    ttclid?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    campaignId?: string;
    adsetId?: string;
    adId?: string;
}
export interface DatalyrConfig {
    apiKey: string;
    workspaceId?: string;
    debug?: boolean;
    apiUrl?: string;
    endpoint?: string;
    useServerTracking?: boolean;
    maxRetries?: number;
    retryDelay?: number;
    timeout?: number;
    batchSize?: number;
    flushInterval?: number;
    maxQueueSize?: number;
    maxEventQueueSize?: number;
    respectDoNotTrack?: boolean;
    enableAutoEvents?: boolean;
    enableAttribution?: boolean;
    enableWebToAppAttribution?: boolean;
    autoEvents?: AutoEventConfig;
    autoEventConfig?: AutoEventConfig;
    retryConfig?: {
        maxRetries: number;
        retryDelay: number;
    };
    skadTemplate?: 'ecommerce' | 'gaming' | 'subscription';
    meta?: MetaConfig;
    tiktok?: TikTokConfig;
}
export interface EventData {
    [key: string]: any;
    userId?: string;
    value?: number;
    currency?: string;
    screen?: string;
    app_version?: string;
    platform?: 'ios' | 'android' | 'windows' | 'macos' | 'web';
    os_version?: string;
    device_model?: string;
    app_build?: string;
    network_type?: string;
}
export interface FingerprintData {
    deviceId?: string;
    deviceInfo?: {
        model: string;
        manufacturer: string;
        osVersion: string;
        screenSize: string;
        timezone: string;
        locale?: string;
        carrier?: string;
        isEmulator?: boolean;
    };
}
export interface EventPayload {
    workspaceId: string;
    visitorId: string;
    anonymousId: string;
    sessionId: string;
    eventId: string;
    eventName: string;
    eventData?: EventData;
    fingerprintData?: FingerprintData;
    source: 'mobile_app';
    timestamp: string;
    userId?: string;
    userProperties?: Record<string, any>;
}
export interface UserProperties {
    [key: string]: any;
    email?: string;
    name?: string;
    phone?: string;
    age?: number;
    gender?: string;
}
export interface SDKState {
    initialized: boolean;
    config: DatalyrConfig;
    visitorId: string;
    anonymousId: string;
    sessionId: string;
    currentUserId?: string;
    userProperties: UserProperties;
    eventQueue: QueuedEvent[];
    isOnline: boolean;
}
export interface QueuedEvent {
    payload: EventPayload;
    timestamp: number;
    retryCount: number;
}
export type AppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';
export type AppStateType = AppState;
export interface NetworkState {
    isConnected: boolean;
    type: string;
}
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
export interface AttributionData {
    campaign?: string;
    source?: string;
    medium?: string;
    term?: string;
    content?: string;
    clickId?: string;
    installTime?: string;
}
