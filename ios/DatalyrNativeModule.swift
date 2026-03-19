import ExpoModulesCore
import AdServices
import AppTrackingTransparency
import AdSupport

public class DatalyrNativeModule: Module {

  public func definition() -> ModuleDefinition {
    Name("DatalyrNative")

    // MARK: - SDK Availability Check

    AsyncFunction("getSDKAvailability") { (promise: Promise) in
      promise.resolve([
        "appleSearchAds": true
      ])
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

      promise.resolve(result)
    }

    // MARK: - Apple Search Ads Attribution

    AsyncFunction("getAppleSearchAdsAttribution") { (promise: Promise) in
      if #available(iOS 14.3, *) {
        do {
          let token = try AAAttribution.attributionToken()

          var request = URLRequest(url: URL(string: "https://api-adservices.apple.com/api/v1/")!)
          request.httpMethod = "POST"
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
