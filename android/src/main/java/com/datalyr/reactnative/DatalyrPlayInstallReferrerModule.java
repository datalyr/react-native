package com.datalyr.reactnative;

import android.os.RemoteException;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;

/**
 * Google Play Install Referrer Module for Android
 *
 * Captures install attribution data from Google Play Store:
 * - UTM parameters (utm_source, utm_medium, utm_campaign, etc.)
 * - Google Ads click ID (gclid)
 * - Referrer timestamps
 *
 * This data is critical for attributing installs to marketing campaigns.
 */
public class DatalyrPlayInstallReferrerModule extends ReactContextBaseJavaModule {
    private static final String TAG = "DatalyrPlayReferrer";
    private static final String MODULE_NAME = "DatalyrPlayInstallReferrer";

    private final ReactApplicationContext reactContext;
    private InstallReferrerClient referrerClient;

    public DatalyrPlayInstallReferrerModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return MODULE_NAME;
    }

    /**
     * Check if Play Install Referrer is available
     */
    @ReactMethod
    public void isAvailable(Promise promise) {
        try {
            // Check if the Play Install Referrer library is available
            Class.forName("com.android.installreferrer.api.InstallReferrerClient");
            promise.resolve(true);
        } catch (ClassNotFoundException e) {
            promise.resolve(false);
        }
    }

    /**
     * Get install referrer data from Google Play
     *
     * Returns an object with:
     * - referrerUrl: The full referrer URL
     * - referrerClickTimestamp: When the referrer link was clicked (ms)
     * - installBeginTimestamp: When the install began (ms)
     * - installCompleteTimestamp: When install was completed (ms) - Android 10+
     * - gclid: Google Ads click ID (if present)
     * - utmSource, utmMedium, utmCampaign, etc.
     */
    @ReactMethod
    public void getInstallReferrer(final Promise promise) {
        try {
            referrerClient = InstallReferrerClient.newBuilder(reactContext.getApplicationContext()).build();

            referrerClient.startConnection(new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    switch (responseCode) {
                        case InstallReferrerClient.InstallReferrerResponse.OK:
                            try {
                                ReferrerDetails details = referrerClient.getInstallReferrer();
                                WritableMap result = parseReferrerDetails(details);
                                promise.resolve(result);
                            } catch (RemoteException e) {
                                Log.e(TAG, "Failed to get install referrer", e);
                                promise.resolve(null);
                            } finally {
                                referrerClient.endConnection();
                            }
                            break;

                        case InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED:
                            Log.d(TAG, "Install referrer not supported on this device");
                            promise.resolve(null);
                            referrerClient.endConnection();
                            break;

                        case InstallReferrerClient.InstallReferrerResponse.SERVICE_UNAVAILABLE:
                            Log.d(TAG, "Install referrer service unavailable");
                            promise.resolve(null);
                            referrerClient.endConnection();
                            break;

                        default:
                            Log.d(TAG, "Install referrer unknown response: " + responseCode);
                            promise.resolve(null);
                            referrerClient.endConnection();
                            break;
                    }
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    Log.d(TAG, "Install referrer service disconnected");
                    // Connection lost - can try to reconnect if needed
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Failed to start install referrer client", e);
            promise.resolve(null);
        }
    }

    /**
     * Parse ReferrerDetails into a WritableMap with UTM parameters extracted
     */
    private WritableMap parseReferrerDetails(ReferrerDetails details) {
        WritableMap result = Arguments.createMap();

        try {
            String referrerUrl = details.getInstallReferrer();
            result.putString("referrerUrl", referrerUrl);
            result.putDouble("referrerClickTimestamp", details.getReferrerClickTimestampSeconds() * 1000.0);
            result.putDouble("installBeginTimestamp", details.getInstallBeginTimestampSeconds() * 1000.0);

            // Android 10+ has install complete timestamp
            try {
                long installCompleteTs = details.getInstallBeginTimestampServerSeconds();
                if (installCompleteTs > 0) {
                    result.putDouble("installCompleteTimestamp", installCompleteTs * 1000.0);
                }
            } catch (NoSuchMethodError e) {
                // Method not available on older Android versions
            }

            // Parse UTM parameters from referrer URL
            if (referrerUrl != null && !referrerUrl.isEmpty()) {
                Map<String, String> params = parseReferrerUrl(referrerUrl);

                // UTM parameters
                if (params.containsKey("utm_source")) {
                    result.putString("utmSource", params.get("utm_source"));
                }
                if (params.containsKey("utm_medium")) {
                    result.putString("utmMedium", params.get("utm_medium"));
                }
                if (params.containsKey("utm_campaign")) {
                    result.putString("utmCampaign", params.get("utm_campaign"));
                }
                if (params.containsKey("utm_term")) {
                    result.putString("utmTerm", params.get("utm_term"));
                }
                if (params.containsKey("utm_content")) {
                    result.putString("utmContent", params.get("utm_content"));
                }

                // Google Ads click ID
                if (params.containsKey("gclid")) {
                    result.putString("gclid", params.get("gclid"));
                }

                // Other potential click IDs
                if (params.containsKey("fbclid")) {
                    result.putString("fbclid", params.get("fbclid"));
                }
                if (params.containsKey("ttclid")) {
                    result.putString("ttclid", params.get("ttclid"));
                }

                // App referrer (used by some attribution providers)
                if (params.containsKey("referrer")) {
                    result.putString("referrer", params.get("referrer"));
                }
            }

            Log.d(TAG, "Install referrer parsed successfully");

        } catch (Exception e) {
            Log.e(TAG, "Failed to parse referrer details", e);
        }

        return result;
    }

    /**
     * Parse URL-encoded referrer string into key-value pairs
     */
    private Map<String, String> parseReferrerUrl(String referrerUrl) {
        Map<String, String> params = new HashMap<>();

        if (referrerUrl == null || referrerUrl.isEmpty()) {
            return params;
        }

        try {
            // Decode the URL-encoded referrer
            String decoded = URLDecoder.decode(referrerUrl, "UTF-8");

            // Split by & to get key=value pairs
            String[] pairs = decoded.split("&");
            for (String pair : pairs) {
                int idx = pair.indexOf('=');
                if (idx > 0 && idx < pair.length() - 1) {
                    String key = pair.substring(0, idx);
                    String value = pair.substring(idx + 1);
                    params.put(key, value);
                }
            }
        } catch (UnsupportedEncodingException e) {
            Log.e(TAG, "Failed to decode referrer URL", e);
        }

        return params;
    }
}
