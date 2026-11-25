import ExpoModulesCore
import AdServices
import AppTrackingTransparency
import AdSupport

// The ATT status when this app process started. iOS lifts its block on the privacy
// manifest's tracking domains only for processes started after tracking was allowed, so the
// JS side may use the tracking host only when this reads authorized. Process-wide (a JS
// reload keeps it), in memory only.
final class DatalyrProcessStartATT: @unchecked Sendable {
  static let shared = DatalyrProcessStartATT()
  private let lock = NSLock()
  private var status: Int?

  /// Records the status the first time it is called in this process; later calls keep it.
  func record() {
    lock.lock(); defer { lock.unlock() }
    if status != nil { return }
    if #available(iOS 14, *) {
      status = Int(ATTrackingManager.trackingAuthorizationStatus.rawValue)
    } else {
      status = 3
    }
  }

  var value: Int? {
    lock.lock(); defer { lock.unlock() }
    return status
  }
}

public class DatalyrNativeModule: Module {

  public func definition() -> ModuleDefinition {
    Name("DatalyrNative")

    // Created with the app's module registry at start-up, before the app can ask for ATT.
    OnCreate {
      DatalyrProcessStartATT.shared.record()
    }

    // MARK: - SDK Availability Check

    AsyncFunction("getSDKAvailability") { (promise: Promise) in
      promise.resolve([
        "appleSearchAds": true
      ])
    }

    // MARK: - First-launch install signals (1.8.0)

    AsyncFunction("getInstallSignals") { (promise: Promise) in
      Task {
        promise.resolve(await DatalyrInstallSignals.read())
      }
    }

    // MARK: - Advertiser Info (IDFA, IDFV, ATT Status)

    AsyncFunction("getAdvertiserInfo") { (promise: Promise) in
      var result: [String: Any] = [:]

      // IDFV is always available
      if let idfv = UIDevice.current.identifierForVendor?.uuidString {
        result["idfv"] = idfv
      }

      // ATT status
      if #available(iOS 14, *) {
        let status = ATTrackingManager.trackingAuthorizationStatus
        result["att_status"] = status.rawValue
        result["advertiser_tracking_enabled"] = status == .authorized

        // IDFA only if ATT authorized
        if status == .authorized {
          let idfa = ASIdentifierManager.shared().advertisingIdentifier.uuidString
          let zeroUUID = "00000000-0000-0000-0000-000000000000"
          if idfa != zeroUUID {
            result["idfa"] = idfa
          }
        }
      } else {
        // Pre-iOS 14, tracking allowed by default
        result["att_status"] = 3  // .authorized equivalent
        result["advertiser_tracking_enabled"] = true
        let idfa = ASIdentifierManager.shared().advertisingIdentifier.uuidString
        let zeroUUID = "00000000-0000-0000-0000-000000000000"
        if idfa != zeroUUID {
          result["idfa"] = idfa
        }
      }

      if let startStatus = DatalyrProcessStartATT.shared.value {
        result["att_status_at_process_start"] = startStatus
      }

      promise.resolve(result)
    }

    // MARK: - Apple Search Ads Attribution

    AsyncFunction("getAppleSearchAdsAttribution") { (promise: Promise) in
      if #available(iOS 14.3, *) {
        do {
          let token = try AAAttribution.attributionToken()

          var request = URLRequest(url: URL(string: "https://api-adservices.apple.com/api/v1/")!)
          request.httpMethod = "POST"
          request.timeoutInterval = 5
          request.setValue("text/plain", forHTTPHeaderField: "Content-Type")
          request.httpBody = token.data(using: .utf8)

          let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if error != nil {
              promise.resolve(nil)
              return
            }

            guard let data = data else {
              promise.resolve(nil)
              return
            }

            do {
              if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                promise.resolve(json)
              } else {
                promise.resolve(nil)
              }
            } catch {
              promise.resolve(nil)
            }
          }
          task.resume()

        } catch {
          promise.resolve(nil)
        }
      } else {
        promise.resolve(nil)
      }
    }
  }
}
