import ExpoModulesCore
import StoreKit
#if canImport(AdAttributionKit)
import AdAttributionKit
#endif

// SKAdNetwork and AdAttributionKit are separate attribution systems; an ad network
// may run either. On iOS 17.4+ every conversion value is sent to BOTH. SKAdNetwork's
// completion is the authority for the JS high-water guard; the AdAttributionKit call
// is best-effort (it throws when there is no AAK impression for this install).
@available(iOS 17.4, *)
private func updateAdAttributionKit(fine: Int, coarse: String, lock: Bool, reengagement: Bool = false) async -> Bool {
  #if canImport(AdAttributionKit)
  let coarseValue: AdAttributionKit.CoarseConversionValue
  switch coarse {
  case "high": coarseValue = .high
  case "medium": coarseValue = .medium
  default: coarseValue = .low
  }
  do {
    if #available(iOS 18.0, *) {
      try await Postback.updateConversionValue(PostbackUpdate(
        fineConversionValue: fine,
        lockPostback: lock,
        coarseConversionValue: coarseValue,
        conversionTypes: reengagement ? [.reengagement] : nil))
    } else {
      try await Postback.updateConversionValue(fine, coarseConversionValue: coarseValue, lockPostback: lock)
    }
    return true
  } catch {
    return false
  }
  #else
  return false
  #endif
}

private var reengagementSupported: Bool {
  if #available(iOS 18.0, *) { return true }
  return false
}

public class DatalyrSKAdNetworkModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DatalyrSKAdNetwork")

    // SKAN 3.0 - Legacy method for iOS 14.0-16.0
    AsyncFunction("updateConversionValue") { (value: Int, promise: Promise) in
      if #available(iOS 14.0, *) {
        SKAdNetwork.updateConversionValue(value)
        promise.resolve(true)
      } else {
        promise.reject("ios_version_error", "SKAdNetwork requires iOS 14.0+")
      }
    }

    // SKAN 4.0 / AdAttributionKit - Method for iOS 16.1+ with coarse value and lock window support
    // On iOS 17.4+, this uses AdAttributionKit under the hood
    AsyncFunction("updatePostbackConversionValue") { (fineValue: Int, coarseValue: String, lockWindow: Bool, promise: Promise) in
      guard fineValue >= 0 && fineValue <= 63 else {
        promise.reject("invalid_value", "Conversion value must be between 0 and 63")
        return
      }

      if #available(iOS 16.1, *) {
        let coarse = Self.mapCoarseValue(coarseValue)

        SKAdNetwork.updatePostbackConversionValue(fineValue, coarseValue: coarse, lockWindow: lockWindow) { error in
          if let error = error {
            promise.reject("skadnetwork_error", error.localizedDescription)
          } else if #available(iOS 17.4, *) {
            Task {
              let aak = await updateAdAttributionKit(fine: fineValue, coarse: coarseValue, lock: lockWindow)
              promise.resolve([
                "success": true,
                "framework": "AdAttributionKit",
                "adAttributionKitAccepted": aak,
                "fineValue": fineValue,
                "coarseValue": coarseValue,
                "lockWindow": lockWindow
              ] as [String: Any])
            }
          } else {
            promise.resolve([
              "success": true,
              "framework": "SKAdNetwork",
              "fineValue": fineValue,
              "coarseValue": coarseValue,
              "lockWindow": lockWindow
            ] as [String: Any])
          }
        }
      } else if #available(iOS 14.0, *) {
        // Fallback to SKAN 3.0 for iOS 14.0-16.0
        SKAdNetwork.updateConversionValue(fineValue)
        promise.resolve([
          "success": true,
          "framework": "SKAdNetwork",
          "fineValue": fineValue,
          "coarseValue": "n/a",
          "lockWindow": false
        ] as [String: Any])
      } else {
        promise.reject("ios_version_error", "SKAdNetwork requires iOS 14.0+")
      }
    }

    // Check if SKAN 4.0 is available (iOS 16.1+)
    AsyncFunction("isSKAN4Available") { (promise: Promise) in
      if #available(iOS 16.1, *) {
        promise.resolve(true)
      } else {
        promise.resolve(false)
      }
    }

    // Check if AdAttributionKit is available (iOS 17.4+)
    AsyncFunction("isAdAttributionKitAvailable") { (promise: Promise) in
      if #available(iOS 17.4, *) {
        promise.resolve(true)
      } else {
        promise.resolve(false)
      }
    }

    // Check if overlapping windows are available (iOS 18.4+)
    AsyncFunction("isOverlappingWindowsAvailable") { (promise: Promise) in
      if #available(iOS 18.4, *) {
        promise.resolve(true)
      } else {
        promise.resolve(false)
      }
    }

    // Register for ad network attribution (supports both AdAttributionKit and SKAdNetwork)
    AsyncFunction("registerForAttribution") { (promise: Promise) in
      if #available(iOS 17.4, *) {
        SKAdNetwork.updatePostbackConversionValue(0, coarseValue: .low, lockWindow: false) { error in
          if let error = error {
            promise.reject("attribution_error", error.localizedDescription)
          } else {
            promise.resolve(["framework": "AdAttributionKit", "registered": true] as [String: Any])
          }
        }
      } else if #available(iOS 14.0, *) {
        SKAdNetwork.registerAppForAdNetworkAttribution()
        promise.resolve(["framework": "SKAdNetwork", "registered": true] as [String: Any])
      } else {
        promise.reject("ios_version_error", "Attribution requires iOS 14.0+")
      }
    }

    // Get attribution framework info
    AsyncFunction("getAttributionInfo") { (promise: Promise) in
      promise.resolve(Self.buildAttributionInfo())
    }

    // Update conversion value for re-engagement (AdAttributionKit iOS 17.4+ only)
    // Re-engagement postback (AdAttributionKit PostbackUpdate.conversionTypes, iOS 18.0+).
    // The app must opt in with EligibleForAdAttributionKitReengagementPostbackCopies to
    // receive copies (the config plugin sets it via `reengagementPostbackCopies: true`).
    AsyncFunction("updateReengagementConversionValue") { (fineValue: Int, coarseValue: String, lockWindow: Bool, promise: Promise) in
      guard fineValue >= 0 && fineValue <= 63 else {
        promise.reject("invalid_value", "Conversion value must be between 0 and 63")
        return
      }
      if #available(iOS 18.0, *) {
        Task {
          let accepted = await updateAdAttributionKit(fine: fineValue, coarse: coarseValue, lock: lockWindow, reengagement: true)
          if accepted {
            promise.resolve([
              "success": true,
              "type": "reengagement",
              "framework": "AdAttributionKit",
              "fineValue": fineValue,
              "coarseValue": coarseValue,
              "lockWindow": lockWindow
            ] as [String: Any])
          } else {
            promise.reject("reengagement_error", "AdAttributionKit did not accept the re-engagement postback update (no eligible impression on this device?)")
          }
        }
      } else {
        promise.reject("unsupported", "Re-engagement postbacks require iOS 18.0+ (AdAttributionKit PostbackUpdate)")
      }
    }

    // iOS 18.4+ - Check if geo-level postback data is available
    AsyncFunction("isGeoPostbackAvailable") { (promise: Promise) in
      if #available(iOS 18.4, *) {
        promise.resolve(true)
      } else {
        promise.resolve(false)
      }
    }

    // iOS 18.4+ - Set postback environment for testing
    AsyncFunction("setPostbackEnvironment") { (environment: String, promise: Promise) in
      if #available(iOS 18.4, *) {
        let isSandbox = environment == "sandbox"
        NSLog("[Datalyr] Postback environment set to: %@ (note: actual sandbox mode is controlled via device Developer Mode)", environment)
        promise.resolve([
          "environment": environment,
          "isSandbox": isSandbox,
          "note": "Enable Developer Mode in iOS Settings for sandbox postbacks"
        ] as [String: Any])
      } else {
        promise.reject("unsupported", "Development postbacks require iOS 18.4+")
      }
    }

    // iOS 18.4+ - Get enhanced attribution info including geo availability
    AsyncFunction("getEnhancedAttributionInfo") { (promise: Promise) in
      promise.resolve(Self.buildEnhancedAttributionInfo())
    }

    // iOS 18.4+ - Update postback with overlapping window support
    AsyncFunction("updatePostbackWithWindow") { (fineValue: Int, coarseValue: String, lockWindow: Bool, windowIndex: Int, promise: Promise) in
      guard fineValue >= 0 && fineValue <= 63 else {
        promise.reject("invalid_value", "Conversion value must be between 0 and 63")
        return
      }

      guard windowIndex >= 0 && windowIndex <= 2 else {
        promise.reject("invalid_window", "Window index must be 0, 1, or 2")
        return
      }

      if #available(iOS 16.1, *) {
        let coarse = Self.mapCoarseValue(coarseValue)

        SKAdNetwork.updatePostbackConversionValue(fineValue, coarseValue: coarse, lockWindow: lockWindow) { error in
          if let error = error {
            promise.reject("postback_error", error.localizedDescription)
          } else {
            var framework = "SKAdNetwork"
            var version = "4.0"
            var overlapping = false

            if #available(iOS 18.4, *) {
              framework = "AdAttributionKit"
              version = "2.0"
              overlapping = true
            } else if #available(iOS 17.4, *) {
              framework = "AdAttributionKit"
              version = "1.0"
            }
            if #available(iOS 17.4, *) {
              Task { _ = await updateAdAttributionKit(fine: fineValue, coarse: coarseValue, lock: lockWindow) }
            }

            promise.resolve([
              "success": true,
              "framework": framework,
              "version": version,
              "fineValue": fineValue,
              "coarseValue": coarseValue,
              "lockWindow": lockWindow,
              "windowIndex": windowIndex,
              "overlappingWindows": overlapping,
            ] as [String: Any])
          }
        }
      } else {
        promise.reject("unsupported", "This method requires iOS 16.1+")
      }
    }
  }

  // MARK: - Helper Methods

  @available(iOS 16.1, *)
  private static func mapCoarseValue(_ value: String) -> SKAdNetwork.CoarseConversionValue {
    switch value {
    case "high": return .high
    case "medium": return .medium
    default: return .low
    }
  }

  private static func buildAttributionInfo() -> [String: Any] {
    var info: [String: Any] = [:]

    if #available(iOS 17.4, *) {
      info["framework"] = "AdAttributionKit"
      info["version"] = "1.0"
      info["reengagement_available"] = reengagementSupported
      info["fine_value_range"] = ["min": 0, "max": 63]
      info["coarse_values"] = ["low", "medium", "high"]
      if #available(iOS 18.4, *) {
        info["overlapping_windows"] = true
      } else {
        info["overlapping_windows"] = false
      }
    } else if #available(iOS 16.1, *) {
      info["framework"] = "SKAdNetwork"
      info["version"] = "4.0"
      info["reengagement_available"] = false
      info["overlapping_windows"] = false
      info["fine_value_range"] = ["min": 0, "max": 63]
      info["coarse_values"] = ["low", "medium", "high"]
    } else if #available(iOS 14.0, *) {
      info["framework"] = "SKAdNetwork"
      info["version"] = "3.0"
      info["reengagement_available"] = false
      info["overlapping_windows"] = false
      info["fine_value_range"] = ["min": 0, "max": 63]
      info["coarse_values"] = [] as [String]
    } else {
      info["framework"] = "none"
      info["version"] = "0"
      info["reengagement_available"] = false
      info["overlapping_windows"] = false
      info["fine_value_range"] = ["min": 0, "max": 0]
      info["coarse_values"] = [] as [String]
    }

    return info
  }

  private static func buildEnhancedAttributionInfo() -> [String: Any] {
    if #available(iOS 18.4, *) {
      return [
        "framework": "AdAttributionKit",
        "version": "2.0",
        "reengagement_available": true,
        "overlapping_windows": true,
        "geo_postback_available": true,
        "development_postbacks": true,
        "fine_value_range": ["min": 0, "max": 63],
        "coarse_values": ["low", "medium", "high"],
        "features": ["overlapping_windows", "geo_level_postbacks", "development_postbacks", "reengagement"]
      ] as [String: Any]
    } else if #available(iOS 17.4, *) {
      return [
        "framework": "AdAttributionKit",
        "version": "1.0",
        "reengagement_available": reengagementSupported,
        "overlapping_windows": false,
        "geo_postback_available": false,
        "development_postbacks": false,
        "fine_value_range": ["min": 0, "max": 63],
        "coarse_values": ["low", "medium", "high"],
        "features": reengagementSupported ? ["reengagement"] : [] as [String]
      ] as [String: Any]
    } else if #available(iOS 16.1, *) {
      return [
        "framework": "SKAdNetwork",
        "version": "4.0",
        "reengagement_available": false,
        "overlapping_windows": false,
        "geo_postback_available": false,
        "development_postbacks": false,
        "fine_value_range": ["min": 0, "max": 63],
        "coarse_values": ["low", "medium", "high"],
        "features": [] as [String]
      ] as [String: Any]
    } else if #available(iOS 14.0, *) {
      return [
        "framework": "SKAdNetwork",
        "version": "3.0",
        "reengagement_available": false,
        "overlapping_windows": false,
        "geo_postback_available": false,
        "development_postbacks": false,
        "fine_value_range": ["min": 0, "max": 63],
        "coarse_values": [] as [String],
        "features": [] as [String]
      ] as [String: Any]
    } else {
      return [
        "framework": "none",
        "version": "0",
        "reengagement_available": false,
        "overlapping_windows": false,
        "geo_postback_available": false,
        "development_postbacks": false,
        "fine_value_range": ["min": 0, "max": 0],
        "coarse_values": [] as [String],
        "features": [] as [String]
      ] as [String: Any]
    }
  }
}
