import ExpoModulesCore
import FBSDKCoreKit
import TikTokBusinessSDK
import AdServices

public class DatalyrNativeModule: Module {
  private var tiktokInitialized = false
  private var metaInitialized = false

  public func definition() -> ModuleDefinition {
    Name("DatalyrNative")

    // MARK: - Meta (Facebook) SDK Methods

    AsyncFunction("initializeMetaSDK") { (appId: String, clientToken: String?, advertiserTrackingEnabled: Bool, promise: Promise) in
      DispatchQueue.main.async { [weak self] in
        Settings.shared.appID = appId

        if let token = clientToken, !token.isEmpty {
          Settings.shared.clientToken = token
        }

        Settings.shared.isAdvertiserTrackingEnabled = advertiserTrackingEnabled
        Settings.shared.isAdvertiserIDCollectionEnabled = advertiserTrackingEnabled

        var initError: NSError?
        let success = DatalyrObjCExceptionCatcher.tryBlock({
          ApplicationDelegate.shared.application(
            UIApplication.shared,
            didFinishLaunchingWithOptions: nil
          )
        }, error: &initError)

        if success {
          self?.metaInitialized = true
          promise.resolve(true)
        } else {
          let message = initError?.localizedDescription ?? "Unknown ObjC exception during Meta SDK init"
          promise.reject("meta_init_error", message)
        }
      }
    }

    AsyncFunction("fetchDeferredAppLink") { (promise: Promise) in
      DispatchQueue.main.async {
        AppLinkUtility.fetchDeferredAppLink { url, error in
          if error != nil {
            promise.resolve(nil)
            return
          }

          if let url = url {
            promise.resolve(url.absoluteString)
          } else {
            promise.resolve(nil)
          }
        }
      }
    }

    AsyncFunction("logMetaEvent") { (eventName: String, valueToSum: Double?, parameters: [String: Any]?, promise: Promise) in
      guard self.metaInitialized else {
        promise.reject("meta_not_initialized", "Meta SDK not initialized. Call initializeMetaSDK first.")
        return
      }

      DispatchQueue.main.async {
        var params: [AppEvents.ParameterName: Any] = [:]

        if let dict = parameters {
          for (key, value) in dict {
            params[AppEvents.ParameterName(key)] = value
          }
        }

        var logError: NSError?
        DatalyrObjCExceptionCatcher.tryBlock({
          if let value = valueToSum {
            AppEvents.shared.logEvent(AppEvents.Name(eventName), valueToSum: value, parameters: params)
          } else if params.isEmpty {
            AppEvents.shared.logEvent(AppEvents.Name(eventName))
          } else {
            AppEvents.shared.logEvent(AppEvents.Name(eventName), parameters: params)
          }
        }, error: &logError)

        if let logError = logError {
          promise.reject("meta_event_error", logError.localizedDescription)
        } else {
          promise.resolve(true)
        }
      }
    }

    AsyncFunction("logMetaPurchase") { (amount: Double, currency: String, parameters: [String: Any]?, promise: Promise) in
      guard self.metaInitialized else {
        promise.reject("meta_not_initialized", "Meta SDK not initialized. Call initializeMetaSDK first.")
        return
      }

      DispatchQueue.main.async {
        var params: [AppEvents.ParameterName: Any] = [:]

        if let dict = parameters {
          for (key, value) in dict {
            params[AppEvents.ParameterName(key)] = value
          }
        }

        var logError: NSError?
        DatalyrObjCExceptionCatcher.tryBlock({
          AppEvents.shared.logPurchase(amount: amount, currency: currency, parameters: params)
        }, error: &logError)

        if let logError = logError {
          promise.reject("meta_event_error", logError.localizedDescription)
        } else {
          promise.resolve(true)
        }
      }
    }

    AsyncFunction("setMetaUserData") { (userData: [String: Any], promise: Promise) in
      guard self.metaInitialized else {
        promise.reject("meta_not_initialized", "Meta SDK not initialized. Call initializeMetaSDK first.")
        return
      }

      DispatchQueue.main.async {
        if let email = userData["email"] as? String { AppEvents.shared.setUserData(email, forType: .email) }
        if let firstName = userData["firstName"] as? String { AppEvents.shared.setUserData(firstName, forType: .firstName) }
        if let lastName = userData["lastName"] as? String { AppEvents.shared.setUserData(lastName, forType: .lastName) }
        if let phone = userData["phone"] as? String { AppEvents.shared.setUserData(phone, forType: .phone) }
        if let dateOfBirth = userData["dateOfBirth"] as? String { AppEvents.shared.setUserData(dateOfBirth, forType: .dateOfBirth) }
        if let gender = userData["gender"] as? String { AppEvents.shared.setUserData(gender, forType: .gender) }
        if let city = userData["city"] as? String { AppEvents.shared.setUserData(city, forType: .city) }
        if let state = userData["state"] as? String { AppEvents.shared.setUserData(state, forType: .state) }
        if let zip = userData["zip"] as? String { AppEvents.shared.setUserData(zip, forType: .zip) }
        if let country = userData["country"] as? String { AppEvents.shared.setUserData(country, forType: .country) }

        promise.resolve(true)
      }
    }

    AsyncFunction("clearMetaUserData") { (promise: Promise) in
      guard self.metaInitialized else {
        promise.reject("meta_not_initialized", "Meta SDK not initialized. Call initializeMetaSDK first.")
        return
      }

      DispatchQueue.main.async {
        AppEvents.shared.clearUserData()
        promise.resolve(true)
      }
    }

    AsyncFunction("updateMetaTrackingAuthorization") { (enabled: Bool, promise: Promise) in
      guard self.metaInitialized else {
        promise.reject("meta_not_initialized", "Meta SDK not initialized. Call initializeMetaSDK first.")
        return
      }

      DispatchQueue.main.async {
        Settings.shared.isAdvertiserTrackingEnabled = enabled
        Settings.shared.isAdvertiserIDCollectionEnabled = enabled
        promise.resolve(true)
      }
    }

    // MARK: - TikTok SDK Methods

    AsyncFunction("initializeTikTokSDK") { (appId: String, tiktokAppId: String, accessToken: String?, debug: Bool, promise: Promise) in
      DispatchQueue.main.async { [weak self] in
        guard let token = accessToken, !token.isEmpty else {
          promise.reject("tiktok_init_error", "TikTok accessToken is required. The deprecated init without accessToken has been removed.")
          return
        }

        let config = TikTokConfig(accessToken: token, appId: appId, tiktokAppId: tiktokAppId)

        if debug {
          config?.setLogLevel(TikTokLogLevelDebug)
        }

        guard let validConfig = config else {
          promise.reject("tiktok_init_error", "Failed to create TikTok config")
          return
        }

        var initError: NSError?
        let success = DatalyrObjCExceptionCatcher.tryBlock({
          TikTokBusiness.initializeSdk(validConfig)
        }, error: &initError)

        if success {
          self?.tiktokInitialized = true
          promise.resolve(true)
        } else {
          let message = initError?.localizedDescription ?? "Unknown ObjC exception during TikTok SDK init"
          promise.reject("tiktok_init_error", message)
        }
      }
    }

    AsyncFunction("trackTikTokEvent") { (eventName: String, eventId: String?, properties: [String: Any]?, promise: Promise) in
      guard self.tiktokInitialized else {
        promise.reject("tiktok_not_initialized", "TikTok SDK not initialized. Call initializeTikTokSDK first.")
        return
      }

      DispatchQueue.main.async {
        let event: TikTokBaseEvent

        if let eid = eventId, !eid.isEmpty {
          event = TikTokBaseEvent(eventName: eventName, eventId: eid)
        } else {
          event = TikTokBaseEvent(eventName: eventName)
        }

        if let dict = properties {
          for (key, value) in dict {
            event.addProperty(withKey: key, value: value)
          }
        }

        var trackError: NSError?
        DatalyrObjCExceptionCatcher.tryBlock({
          TikTokBusiness.trackTTEvent(event)
        }, error: &trackError)

        if let trackError = trackError {
          promise.reject("tiktok_event_error", trackError.localizedDescription)
        } else {
          promise.resolve(true)
        }
      }
    }

    AsyncFunction("identifyTikTokUser") { (externalId: String, externalUserName: String, phoneNumber: String, email: String, promise: Promise) in
      guard self.tiktokInitialized else {
        promise.reject("tiktok_not_initialized", "TikTok SDK not initialized. Call initializeTikTokSDK first.")
        return
      }

      DispatchQueue.main.async {
        TikTokBusiness.identify(
          withExternalID: externalId.isEmpty ? nil : externalId,
          externalUserName: externalUserName.isEmpty ? nil : externalUserName,
          phoneNumber: phoneNumber.isEmpty ? nil : phoneNumber,
          email: email.isEmpty ? nil : email
        )
        promise.resolve(true)
      }
    }

    AsyncFunction("logoutTikTok") { (promise: Promise) in
      guard self.tiktokInitialized else {
        promise.reject("tiktok_not_initialized", "TikTok SDK not initialized. Call initializeTikTokSDK first.")
        return
      }

      DispatchQueue.main.async {
        TikTokBusiness.logout()
        promise.resolve(true)
      }
    }

    AsyncFunction("updateTikTokTrackingAuthorization") { (enabled: Bool, promise: Promise) in
      // TikTok SDK handles ATT automatically, but we track the change
      promise.resolve(true)
    }

    // MARK: - SDK Availability Check

    AsyncFunction("getSDKAvailability") { (promise: Promise) in
      promise.resolve([
        "meta": true,
        "tiktok": true,
        "appleSearchAds": true
      ])
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
