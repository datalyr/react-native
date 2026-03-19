package com.datalyr.reactnative;

import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import com.google.android.gms.ads.identifier.AdvertisingIdClient;
import com.google.android.gms.common.GooglePlayServicesNotAvailableException;

/**
 * Datalyr Native Module for Android
 * Provides advertiser info (GAID) for React Native.
 * Conversion event routing to ad platforms is handled server-side via postback.
 */
public class DatalyrNativeModule extends ReactContextBaseJavaModule {
    private static final String TAG = "DatalyrNative";
    private static final String MODULE_NAME = "DatalyrNative";

    private final ReactApplicationContext reactContext;

    public DatalyrNativeModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return MODULE_NAME;
    }

    // ============================================================================
    // SDK Availability
    // ============================================================================

    @ReactMethod
    public void getSDKAvailability(Promise promise) {
        WritableMap result = Arguments.createMap();
        result.putBoolean("playInstallReferrer", true);
        // Apple Search Ads is iOS only
        result.putBoolean("appleSearchAds", false);
        promise.resolve(result);
    }

    // ============================================================================
    // Advertiser Info (GAID on Android)
    // ============================================================================

    @ReactMethod
    public void getAdvertiserInfo(Promise promise) {
        // GAID must be fetched on a background thread
        new Thread(() -> {
            try {
                WritableMap result = Arguments.createMap();

                // Fetch Google Advertising ID
                try {
                    AdvertisingIdClient.Info adInfo = AdvertisingIdClient.getAdvertisingIdInfo(reactContext.getApplicationContext());
                    boolean limitAdTracking = adInfo.isLimitAdTrackingEnabled();
                    result.putBoolean("advertiser_tracking_enabled", !limitAdTracking);
                    result.putInt("att_status", limitAdTracking ? 2 : 3); // 2=denied, 3=authorized

                    if (!limitAdTracking && adInfo.getId() != null) {
                        result.putString("gaid", adInfo.getId());
                    }
                } catch (GooglePlayServicesNotAvailableException e) {
                    // Google Play Services not available (e.g., Huawei devices)
                    result.putInt("att_status", 3);
                    result.putBoolean("advertiser_tracking_enabled", true);
                    Log.d(TAG, "Google Play Services not available for GAID");
                } catch (Exception e) {
                    // Fallback — GAID not available but not blocking
                    result.putInt("att_status", 3);
                    result.putBoolean("advertiser_tracking_enabled", true);
                    Log.d(TAG, "GAID not available: " + e.getMessage());
                }

                promise.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "Failed to get advertiser info: " + e.getMessage());
                promise.resolve(null);
            }
        }).start();
    }
}
