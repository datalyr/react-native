/**
 * 1.8.0: what the first SDK launch on this device is.
 *
 * The SDK used to fire `app_install` on its first launch, keyed only on its own
 * storage marker, so an app that added DATALYR in an update reported every
 * existing user as an install (Clema 2026-10: ~3,300 of 3,563, 952 sent to Meta).
 * RN-24 only caught devices that had run an OLDER DATALYR build. The question is
 * "did a build of this app already run here before this process": files the app
 * wrote in an earlier process predate this process's start, and on Android an
 * app updated in place has lastUpdateTime > firstInstallTime.
 *
 * Mirrors the iOS SDK 2.2.0 InstallClassifier. Decided once, before the SDK
 * writes ids, and persisted (a kill before app_install is enqueued re-fires the
 * same class). Only coarse age buckets leave the device, never raw dates.
 */

export type InstallType = 'new' | 'reinstall' | 'existing_user' | 'unknown';

export interface InstallClassification {
  install_type: InstallType;
  /** host_hint | prior_sdk | ran_before | app_transaction | bundle_vs_container | package_manager | backup_marker | none */
  detection_method: string;
  prior_install_age?: string;
  original_app_version?: string;
}

/** What the native module reports (every field optional: old native builds, web, errors). */
export interface InstallSignals {
  /** A file or folder the app wrote was created before this process started. */
  ranBefore?: boolean;
  /** The oldest such item, and this process's start (an earlier run under a day before
   * this one is as likely a gated SDK start on a fresh install as an old user). */
  earliestEvidenceMs?: number;
  processStartMs?: number;
  /** iOS: the app bundle is well newer than the data container (updated on this device). */
  bundleNewerThanContainer?: boolean;
  /** iOS: Library creation; Android: PackageInfo.firstInstallTime. Never sent. */
  containerCreatedAtMs?: number;
  /** Android: PackageInfo.lastUpdateTime. */
  lastUpdateTimeMs?: number;
  /** iOS AppTransaction, production only. */
  storeOriginalAppVersion?: string;
  storeOriginalPurchaseDateMs?: number;
  currentBuild?: string;
  /** Android: our marker in noBackupFilesDir (never restored by Auto Backup). */
  backupMarkerPresent?: boolean;
}

const DAY_MS = 86_400_000;
/** A reinstall's App Store record predates this container by at least this much. */
const REINSTALL_GAP_MS = DAY_MS;
/** Android: lastUpdateTime this far past firstInstallTime means an update in place. */
const UPDATE_GAP_MS = 60_000;
/** An earlier run less recent than this before the current process counts as an old install. */
const RECENT_RUN_MS = DAY_MS;

export function ageBucket(ms: number | undefined, now: number): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return undefined;
  const days = (now - ms) / DAY_MS;
  if (days < 1) return '<1d';
  if (days < 7) return '1-7d';
  if (days < 30) return '7-30d';
  if (days < 365) return '30-365d';
  return '>1y';
}

function earliest(...values: Array<number | undefined>): number | undefined {
  const known = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return known.length ? Math.min(...known) : undefined;
}

function classification(install_type: InstallType, detection_method: string, extra: Partial<InstallClassification> = {}): InstallClassification {
  const result: InstallClassification = { install_type, detection_method };
  if (extra.prior_install_age) result.prior_install_age = extra.prior_install_age;
  if (extra.original_app_version) result.original_app_version = extra.original_app_version;
  return result;
}

/**
 * The decision. `priorSdk` = keys an older DATALYR build left (RN-24); `hint` =
 * the app's own existingUserHint.
 */
export function classifyInstall(
  s: InstallSignals,
  { platform, hint, priorSdk, now }: { platform: 'ios' | 'android' | string; hint?: boolean | null; priorSdk?: boolean; now: number },
): InstallClassification {
  const original_app_version = s.storeOriginalAppVersion || undefined;
  const age = ageBucket(earliest(s.containerCreatedAtMs, s.storeOriginalPurchaseDateMs), now);
  if (hint === true) return classification('existing_user', 'host_hint', { prior_install_age: age, original_app_version });
  if (priorSdk) return classification('existing_user', 'prior_sdk', { prior_install_age: age, original_app_version });

  if (s.ranBefore === true && s.earliestEvidenceMs !== undefined && s.processStartMs !== undefined
    && s.earliestEvidenceMs > s.processStartMs - RECENT_RUN_MS) {
    // The app first ran here less than a day ago, before the SDK started: a fresh install
    // whose app gates the SDK (consent, login), possibly auto-updated since. Sent like an
    // install, labelled.
    return classification('unknown', 'ran_before_recent', { original_app_version });
  }

  if (platform === 'android') {
    const updatedInPlace = s.containerCreatedAtMs !== undefined && s.lastUpdateTimeMs !== undefined
      && s.lastUpdateTimeMs - s.containerCreatedAtMs > UPDATE_GAP_MS;
    if (s.ranBefore === true && updatedInPlace) {
      return classification('existing_user', 'package_manager', { prior_install_age: age });
    }
    if (s.ranBefore === true) {
      // Never updated here, yet files predate this process: Auto Backup restored app
      // data onto this install (a reinstall or a new device), or the app started the
      // SDK late. Either way it is sent like an install.
      return classification('reinstall', 'ran_before', { prior_install_age: age });
    }
    if (s.ranBefore === false) return classification('new', 'package_manager');
    return classification('unknown', 'none');
  }

  // iOS
  const storeBuildDiffers = original_app_version !== undefined && s.currentBuild !== undefined
    ? original_app_version !== s.currentBuild : undefined;
  if (s.ranBefore === true) {
    if (storeBuildDiffers === false && s.bundleNewerThanContainer !== true) {
      // This very build was the first this Apple Account got, never updated here: the
      // app ran before the SDK started (consent / login gate). A new user.
      return classification('new', 'app_transaction', { original_app_version });
    }
    const method = s.bundleNewerThanContainer === true ? 'bundle_vs_container'
      : storeBuildDiffers === true ? 'app_transaction' : 'ran_before';
    return classification('existing_user', method, { prior_install_age: age, original_app_version });
  }
  if (s.storeOriginalPurchaseDateMs === undefined) {
    return s.ranBefore === false ? classification('new', 'ran_before') : classification('unknown', 'none');
  }
  if (s.containerCreatedAtMs !== undefined && s.storeOriginalPurchaseDateMs < s.containerCreatedAtMs - REINSTALL_GAP_MS) {
    return classification('reinstall', 'app_transaction', {
      prior_install_age: ageBucket(s.storeOriginalPurchaseDateMs, now), original_app_version,
    });
  }
  return classification('new', 'app_transaction', { original_app_version });
}

/**
 * Android, install marker already present (an earlier launch tracked the install):
 * was it restored by Auto Backup onto a NEW install? True when our marker file in
 * noBackupFilesDir is missing and this package was installed after the marker's
 * time. An upgrade from an SDK that never wrote the marker keeps the old install
 * time, so it is not mistaken for a restore.
 */
export function restoredOntoNewInstall(s: InstallSignals, markerTimeMs: number | undefined): boolean {
  if (s.backupMarkerPresent !== false) return false;
  if (markerTimeMs === undefined || s.containerCreatedAtMs === undefined) return false;
  return s.containerCreatedAtMs > markerTimeMs + 60 * 60_000;
}
