// Expo config plugin for @datalyr/react-native.
//
// Usage (app.json / app.config.js):
//   "plugins": [
//     ["@datalyr/react-native", {
//       "networks": ["meta", "tiktok"],
//       "skAdNetworkIds": ["abcd1234ef.skadnetwork"],
//       "trackingUsageDescription": "We use this to measure ad performance.",
//       "attributionCopyEndpoint": "https://example.com",
//       "reengagementPostbackCopies": true
//     }]
//   ]
//
// AdAttributionKit (iOS 17.4+): `attributionCopyEndpoint` sets AttributionCopyEndpoint so
// your server receives copies of winning postbacks at
// https://<host>/.well-known/appattribution/report-attribution/; `reengagementPostbackCopies`
// sets EligibleForAdAttributionKitReengagementPostbackCopies (iOS 18+). Neither is required
// for attribution itself.
//
// iOS: merges SKAdNetworkItems into Info.plist (dedupes, never removes existing entries)
// and sets NSUserTrackingUsageDescription when not already set. Android: no-op (the
// library declares the Play Install Referrer dependency itself).
//
// Requires a development build (`npx expo run:ios` or EAS). Expo Go ignores plugins.
'use strict';

let configPlugins;
try {
  configPlugins = require('expo/config-plugins');
} catch (_) {
  configPlugins = require('@expo/config-plugins');
}
const { withInfoPlist } = configPlugins;
const createRunOncePlugin = configPlugins.createRunOncePlugin || ((plugin) => plugin);

// Well-known SKAdNetwork ids per ad network. Apple Search Ads does NOT use SKAdNetwork
// (it attributes through the AdServices framework), so `apple` contributes no ids and is
// accepted only so callers can list every network they run without a validation error.
const NETWORK_SKADNETWORK_IDS = Object.freeze({
  meta: ['v9wttpbfk9.skadnetwork', 'n38lu8286q.skadnetwork'],
  tiktok: ['238da6jt44.skadnetwork', '22mmun2rn5.skadnetwork'],
  google: ['cstr6suwn9.skadnetwork', '4fzdc2evr5.skadnetwork', '4pfyvq9l8r.skadnetwork'],
  snapchat: ['424m5254lk.skadnetwork', '5l3tpt7t6e.skadnetwork'],
  apple: [],
});

const KNOWN_NETWORKS = Object.keys(NETWORK_SKADNETWORK_IDS);

function normalizeId(id) {
  return String(id || '').trim().toLowerCase();
}

/**
 * Resolve the full id list for the given options (network defaults + explicit ids).
 */
function resolveSkAdNetworkIds(options) {
  const opts = options || {};
  const ids = [];
  const networks = Array.isArray(opts.networks) ? opts.networks : [];
  for (const network of networks) {
    const key = String(network || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(NETWORK_SKADNETWORK_IDS, key)) {
      throw new Error(
        `[@datalyr/react-native] Unknown network '${network}' in plugin options. Known: ${KNOWN_NETWORKS.join(', ')}`
      );
    }
    ids.push(...NETWORK_SKADNETWORK_IDS[key]);
  }
  const explicit = Array.isArray(opts.skAdNetworkIds) ? opts.skAdNetworkIds : [];
  for (const id of explicit) {
    const norm = normalizeId(id);
    if (norm) ids.push(norm);
  }
  return ids;
}

/**
 * Merge ids into an existing SKAdNetworkItems array. Existing entries are never removed
 * or reordered; duplicates (case-insensitive) are skipped.
 */
function mergeSkAdNetworkItems(existingItems, ids) {
  const items = Array.isArray(existingItems) ? existingItems.slice() : [];
  const seen = new Set(
    items
      .map((item) => item && item.SKAdNetworkIdentifier)
      .filter(Boolean)
      .map(normalizeId)
  );
  for (const id of ids) {
    const norm = normalizeId(id);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    items.push({ SKAdNetworkIdentifier: norm });
  }
  return items;
}

function withDatalyrInfoPlist(config, options) {
  const opts = options || {};
  return withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults || (cfg.modResults = {});
    const ids = resolveSkAdNetworkIds(opts);
    if (ids.length > 0 || Array.isArray(plist.SKAdNetworkItems)) {
      plist.SKAdNetworkItems = mergeSkAdNetworkItems(plist.SKAdNetworkItems, ids);
    }
    if (
      typeof opts.trackingUsageDescription === 'string' &&
      opts.trackingUsageDescription.trim() &&
      !plist.NSUserTrackingUsageDescription
    ) {
      plist.NSUserTrackingUsageDescription = opts.trackingUsageDescription;
    }
    if (
      typeof opts.attributionCopyEndpoint === 'string' &&
      /^https:\/\//.test(opts.attributionCopyEndpoint.trim()) &&
      !plist.AttributionCopyEndpoint
    ) {
      plist.AttributionCopyEndpoint = opts.attributionCopyEndpoint.trim().replace(/\/+$/, '');
    }
    if (opts.reengagementPostbackCopies === true) {
      plist.EligibleForAdAttributionKitReengagementPostbackCopies = true;
    }
    return cfg;
  });
}

function withDatalyr(config, options) {
  // Android: no-op. The library's build.gradle already declares
  // com.android.installreferrer:installreferrer; nothing to inject into the app.
  return withDatalyrInfoPlist(config, options);
}

let pkg = { name: '@datalyr/react-native', version: 'UNVERSIONED' };
try {
  pkg = require('./package.json');
} catch (_) {
  // keep fallback
}

const plugin = createRunOncePlugin(withDatalyr, pkg.name, pkg.version);

module.exports = plugin;
module.exports.default = plugin;
module.exports.withDatalyr = withDatalyr;
module.exports.NETWORK_SKADNETWORK_IDS = NETWORK_SKADNETWORK_IDS;
module.exports.resolveSkAdNetworkIds = resolveSkAdNetworkIds;
module.exports.mergeSkAdNetworkItems = mergeSkAdNetworkItems;
