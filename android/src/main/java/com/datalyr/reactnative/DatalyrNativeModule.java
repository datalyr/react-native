package com.datalyr.reactnative;

import android.os.Bundle;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableMapKeySetIterator;
import com.facebook.react.bridge.WritableMap;

// Meta (Facebook) SDK imports
import com.facebook.FacebookSdk;
import com.facebook.appevents.AppEventsLogger;
import com.facebook.appevents.AppEventsConstants;
import com.facebook.appevents.UserDataStore;
import com.facebook.bolts.AppLinks;
import android.net.Uri;

// TikTok SDK imports
import com.tiktok.TikTokBusinessSdk;
import com.tiktok.TikTokBusinessSdk.TTConfig;
import com.tiktok.appevents.TikTokAppEvent;
import com.tiktok.appevents.TikTokAppEventLogger;

import java.math.BigDecimal;
import java.util.Currency;
import java.util.HashMap;
import java.util.Map;

/**
 * Datalyr Native Module for Android
 * Provides Meta (Facebook) and TikTok SDK integrations for React Native
 */
public class DatalyrNativeModule extends ReactContextBaseJavaModule {
    private static final String TAG = "DatalyrNative";
    private static final String MODULE_NAME = "DatalyrNative";

    private final ReactApplicationContext reactContext;
    private AppEventsLogger metaLogger;
    private boolean metaInitialized = false;
    private boolean tiktokInitialized = false;

    public DatalyrNativeModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return MODULE_NAME;
    }

    // ============================================================================
    // Meta (Facebook) SDK Methods
    // ============================================================================

    @ReactMethod
    public void initializeMetaSDK(String appId, String clientToken, boolean advertiserTrackingEnabled, Promise promise) {
        try {
            // Initialize Facebook SDK
            FacebookSdk.setApplicationId(appId);
            if (clientToken != null && !clientToken.isEmpty()) {
                FacebookSdk.setClientToken(clientToken);
            }
            FacebookSdk.setAdvertiserIDCollectionEnabled(advertiserTrackingEnabled);
            FacebookSdk.setAutoLogAppEventsEnabled(true);
            FacebookSdk.sdkInitialize(reactContext.getApplicationContext());

            // Create logger instance
            metaLogger = AppEventsLogger.newLogger(reactContext.getApplicationContext());
            metaInitialized = true;

            Log.d(TAG, "Meta SDK initialized with App ID: " + appId);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize Meta SDK", e);
            promise.reject("meta_init_error", "Failed to initialize Meta SDK: " + e.getMessage());
        }
    }

    @ReactMethod
    public void fetchDeferredAppLink(Promise promise) {
        if (!metaInitialized) {
            promise.resolve(null);
            return;
        }

        try {
            AppLinks.getTargetUrlFromInboundIntent(reactContext.getApplicationContext(), reactContext.getCurrentActivity().getIntent())
                .continueWith(task -> {
                    if (task.getError() != null) {
                        Log.d(TAG, "Deferred app link error: " + task.getError().getMessage());
                        promise.resolve(null);
                        return null;
                    }

                    Uri targetUrl = task.getResult();
                    if (targetUrl != null) {
                        promise.resolve(targetUrl.toString());
                    } else {
                        promise.resolve(null);
                    }
                    return null;
                });
        } catch (Exception e) {
            Log.d(TAG, "Deferred app link not available");
            promise.resolve(null);
        }
    }

    @ReactMethod
    public void logMetaEvent(String eventName, Double valueToSum, ReadableMap parameters, Promise promise) {
        if (!metaInitialized || metaLogger == null) {
            promise.resolve(false);
            return;
        }

        try {
            Bundle params = readableMapToBundle(parameters);

            if (valueToSum != null) {
                metaLogger.logEvent(eventName, valueToSum, params);
            } else if (params.isEmpty()) {
                metaLogger.logEvent(eventName);
            } else {
                metaLogger.logEvent(eventName, params);
            }

            Log.d(TAG, "Meta event logged: " + eventName);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to log Meta event", e);
            promise.reject("meta_event_error", "Failed to log Meta event: " + e.getMessage());
        }
    }

    @ReactMethod
    public void logMetaPurchase(double amount, String currency, ReadableMap parameters, Promise promise) {
        if (!metaInitialized || metaLogger == null) {
            promise.resolve(false);
            return;
        }

        try {
            Bundle params = readableMapToBundle(parameters);
            BigDecimal purchaseAmount = BigDecimal.valueOf(amount);
            Currency currencyObj = Currency.getInstance(currency);

            metaLogger.logPurchase(purchaseAmount, currencyObj, params);

            Log.d(TAG, "Meta purchase logged: " + amount + " " + currency);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to log Meta purchase", e);
            promise.reject("meta_purchase_error", "Failed to log Meta purchase: " + e.getMessage());
        }
    }

    @ReactMethod
    public void setMetaUserData(ReadableMap userData, Promise promise) {
        if (!metaInitialized) {
            promise.resolve(false);
            return;
        }

        try {
            // Set user data for Advanced Matching
            Bundle userDataBundle = new Bundle();

            if (userData.hasKey("email")) {
                userDataBundle.putString("em", userData.getString("email"));
            }
            if (userData.hasKey("firstName")) {
                userDataBundle.putString("fn", userData.getString("firstName"));
            }
            if (userData.hasKey("lastName")) {
                userDataBundle.putString("ln", userData.getString("lastName"));
            }
            if (userData.hasKey("phone")) {
                userDataBundle.putString("ph", userData.getString("phone"));
            }
            if (userData.hasKey("dateOfBirth")) {
                userDataBundle.putString("db", userData.getString("dateOfBirth"));
            }
            if (userData.hasKey("gender")) {
                userDataBundle.putString("ge", userData.getString("gender"));
            }
            if (userData.hasKey("city")) {
                userDataBundle.putString("ct", userData.getString("city"));
            }
            if (userData.hasKey("state")) {
                userDataBundle.putString("st", userData.getString("state"));
            }
            if (userData.hasKey("zip")) {
                userDataBundle.putString("zp", userData.getString("zip"));
            }
            if (userData.hasKey("country")) {
                userDataBundle.putString("country", userData.getString("country"));
            }

            AppEventsLogger.setUserData(
                userData.hasKey("email") ? userData.getString("email") : null,
                userData.hasKey("firstName") ? userData.getString("firstName") : null,
                userData.hasKey("lastName") ? userData.getString("lastName") : null,
                userData.hasKey("phone") ? userData.getString("phone") : null,
                userData.hasKey("dateOfBirth") ? userData.getString("dateOfBirth") : null,
                userData.hasKey("gender") ? userData.getString("gender") : null,
                userData.hasKey("city") ? userData.getString("city") : null,
                userData.hasKey("state") ? userData.getString("state") : null,
                userData.hasKey("zip") ? userData.getString("zip") : null,
                userData.hasKey("country") ? userData.getString("country") : null
            );

            Log.d(TAG, "Meta user data set for Advanced Matching");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to set Meta user data", e);
            promise.reject("meta_userdata_error", "Failed to set Meta user data: " + e.getMessage());
        }
    }

    @ReactMethod
    public void clearMetaUserData(Promise promise) {
        if (!metaInitialized) {
            promise.resolve(false);
            return;
        }

        try {
            AppEventsLogger.clearUserData();
            Log.d(TAG, "Meta user data cleared");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to clear Meta user data", e);
            promise.reject("meta_clear_error", "Failed to clear Meta user data: " + e.getMessage());
        }
    }

    @ReactMethod
    public void updateMetaTrackingAuthorization(boolean enabled, Promise promise) {
        try {
            FacebookSdk.setAdvertiserIDCollectionEnabled(enabled);
            Log.d(TAG, "Meta tracking authorization updated: " + enabled);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to update Meta tracking authorization", e);
            promise.reject("meta_tracking_error", "Failed to update Meta tracking: " + e.getMessage());
        }
    }

    // ============================================================================
    // TikTok SDK Methods
    // ============================================================================

    @ReactMethod
    public void initializeTikTokSDK(String appId, String tiktokAppId, String accessToken, boolean debug, Promise promise) {
        try {
            TTConfig config = new TTConfig(reactContext.getApplicationContext())
                .setAppId(appId)
                .setTTAppId(tiktokAppId);

            if (accessToken != null && !accessToken.isEmpty()) {
                config.setAccessToken(accessToken);
            }

            if (debug) {
                config.openDebugMode();
            }

            TikTokBusinessSdk.initializeSdk(config);
            tiktokInitialized = true;

            Log.d(TAG, "TikTok SDK initialized with App ID: " + tiktokAppId);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize TikTok SDK", e);
            promise.reject("tiktok_init_error", "Failed to initialize TikTok SDK: " + e.getMessage());
        }
    }

    @ReactMethod
    public void trackTikTokEvent(String eventName, String eventId, ReadableMap properties, Promise promise) {
        if (!tiktokInitialized) {
            promise.resolve(false);
            return;
        }

        try {
            TikTokAppEvent event;
            if (eventId != null && !eventId.isEmpty()) {
                event = new TikTokAppEvent(eventName).setEventId(eventId);
            } else {
                event = new TikTokAppEvent(eventName);
            }

            // Add properties to the event
            if (properties != null) {
                ReadableMapKeySetIterator iterator = properties.keySetIterator();
                while (iterator.hasNextKey()) {
                    String key = iterator.nextKey();
                    switch (properties.getType(key)) {
                        case String:
                            event.addProperty(key, properties.getString(key));
                            break;
                        case Number:
                            event.addProperty(key, properties.getDouble(key));
                            break;
                        case Boolean:
                            event.addProperty(key, properties.getBoolean(key));
                            break;
                        default:
                            break;
                    }
                }
            }

            TikTokBusinessSdk.trackTTEvent(event);

            Log.d(TAG, "TikTok event logged: " + eventName);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to log TikTok event", e);
            promise.reject("tiktok_event_error", "Failed to log TikTok event: " + e.getMessage());
        }
    }

    @ReactMethod
    public void identifyTikTokUser(String externalId, String externalUserName, String phoneNumber, String email, Promise promise) {
        if (!tiktokInitialized) {
            promise.resolve(false);
            return;
        }

        try {
            TikTokBusinessSdk.identify(
                externalId != null && !externalId.isEmpty() ? externalId : null,
                externalUserName != null && !externalUserName.isEmpty() ? externalUserName : null,
                phoneNumber != null && !phoneNumber.isEmpty() ? phoneNumber : null,
                email != null && !email.isEmpty() ? email : null
            );

            Log.d(TAG, "TikTok user identified");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to identify TikTok user", e);
            promise.reject("tiktok_identify_error", "Failed to identify TikTok user: " + e.getMessage());
        }
    }

    @ReactMethod
    public void logoutTikTok(Promise promise) {
        if (!tiktokInitialized) {
            promise.resolve(false);
            return;
        }

        try {
            TikTokBusinessSdk.logout();
            Log.d(TAG, "TikTok user logged out");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to logout TikTok user", e);
            promise.reject("tiktok_logout_error", "Failed to logout TikTok user: " + e.getMessage());
        }
    }

    @ReactMethod
    public void updateTikTokTrackingAuthorization(boolean enabled, Promise promise) {
        // TikTok SDK handles this automatically on Android
        // No explicit method needed
        Log.d(TAG, "TikTok tracking authorization update requested: " + enabled);
        promise.resolve(true);
    }

    // ============================================================================
    // SDK Availability
    // ============================================================================

    @ReactMethod
    public void getSDKAvailability(Promise promise) {
        WritableMap result = Arguments.createMap();
        result.putBoolean("meta", true);
        result.putBoolean("tiktok", true);
        result.putBoolean("playInstallReferrer", true);
        // Apple Search Ads is iOS only
        result.putBoolean("appleSearchAds", false);
        promise.resolve(result);
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private Bundle readableMapToBundle(ReadableMap map) {
        Bundle bundle = new Bundle();
        if (map == null) {
            return bundle;
        }

        ReadableMapKeySetIterator iterator = map.keySetIterator();
        while (iterator.hasNextKey()) {
            String key = iterator.nextKey();
            switch (map.getType(key)) {
                case String:
                    bundle.putString(key, map.getString(key));
                    break;
                case Number:
                    bundle.putDouble(key, map.getDouble(key));
                    break;
                case Boolean:
                    bundle.putBoolean(key, map.getBoolean(key));
                    break;
                default:
                    break;
            }
        }
        return bundle;
    }
}
