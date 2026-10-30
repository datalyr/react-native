package com.datalyr.reactnative;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;

import java.io.File;

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
    // First-launch install signals (1.8.0)
    // ============================================================================

    private static final String INSTALL_MARKER = "datalyr_install_marker";

    /**
     * What the OS says about this install, for telling a real install from an existing
     * user's first launch after an update added the SDK: PackageInfo first-install and
     * last-update times (kept on update, reset on reinstall), whether files the app
     * wrote predate this process (Auto Backup restores them before first launch, and an
     * earlier run of the app leaves them), and our marker in noBackupFilesDir. Read on
     * the first SDK launch only; raw times are bucketed in JS and never sent.
     */
    @ReactMethod
    public void getInstallSignals(Promise promise) {
        try {
            Context context = reactContext.getApplicationContext();
            WritableMap result = Arguments.createMap();
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            result.putDouble("containerCreatedAtMs", (double) info.firstInstallTime);
            result.putDouble("lastUpdateTimeMs", (double) info.lastUpdateTime);
            long versionCode = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            result.putString("currentBuild", String.valueOf(versionCode));
            if (Build.VERSION.SDK_INT >= 24) {
                long processStart = System.currentTimeMillis()
                    - (SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime());
                long earliest = earliestFileBefore(context, processStart - 1000);
                result.putBoolean("ranBefore", earliest > 0);
                result.putDouble("processStartMs", (double) processStart);
                if (earliest > 0) result.putDouble("earliestEvidenceMs", (double) earliest);
            }
            result.putBoolean("backupMarkerPresent", new File(context.getNoBackupFilesDir(), INSTALL_MARKER).exists());
            promise.resolve(result);
        } catch (Exception e) {
            Log.w(TAG, "Install signals unavailable", e);
            promise.resolve(null);
        }
    }

    @ReactMethod
    public void writeInstallMarker(Promise promise) {
        try {
            File marker = new File(reactContext.getApplicationContext().getNoBackupFilesDir(), INSTALL_MARKER);
            promise.resolve(marker.exists() || marker.createNewFile());
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    /**
     * The oldest top-level item the app writes (files/, shared_prefs/, databases/) last
     * changed before cutoff, or 0. Last-modified, not creation: Android does not expose a
     * birth time, so an item rewritten in this process is not counted (only hides evidence).
     */
    private static long earliestFileBefore(Context context, long cutoffMs) {
        File dataDir = new File(context.getApplicationInfo().dataDir);
        File[] roots = { context.getFilesDir(), new File(dataDir, "shared_prefs"), new File(dataDir, "databases") };
        long earliest = 0;
        for (File root : roots) {
            File[] children = root == null ? null : root.listFiles();
            if (children == null) continue;
            int seen = 0;
            for (File child : children) {
                if (++seen > 50) break;
                if (child.getName().startsWith(".")) continue;
                long modified = child.lastModified();
                if (modified > 0 && modified < cutoffMs && (earliest == 0 || modified < earliest)) earliest = modified;
            }
        }
        return earliest;
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

                    String gaid = adInfo.getId();
                    // Android 13+ returns the zero id when AD_ID is not granted.
                    if (!limitAdTracking && gaid != null && !gaid.equals("00000000-0000-0000-0000-000000000000")) {
                        result.putString("gaid", gaid);
                    }
                } catch (GooglePlayServicesNotAvailableException e) {
                    // Google Play Services not available (e.g., Huawei devices): no ad id,
                    // so report "not determined" rather than a false "authorized".
                    result.putInt("att_status", 0);
                    result.putBoolean("advertiser_tracking_enabled", false);
                    Log.d(TAG, "Google Play Services not available for GAID");
                } catch (Exception e) {
                    // Fallback — GAID not available but not blocking
                    result.putInt("att_status", 0);
                    result.putBoolean("advertiser_tracking_enabled", false);
                    Log.d(TAG, "GAID not available: " + e.getMessage());
                }

                promise.resolve(result);
            } catch (Throwable e) {
                // Throwable: a NoClassDefFoundError (ads-identifier excluded by the app)
                // on this raw Thread would otherwise kill the process.
                Log.e(TAG, "Failed to get advertiser info: " + e.getMessage());
                promise.resolve(null);
            }
        }).start();
    }
}
