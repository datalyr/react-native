import ExpoModulesCore
import FBSDKCoreKit
import TikTokBusinessSDK
import AdServices

public class DatalyrNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DatalyrNative")

    // MARK: - Meta (Facebook) SDK Methods

    AsyncFunction("initializeMetaSDK") { (appId: String, clientToken: String?, advertiserTrackingEnabled: Bool, promise: Promise) in
      DispatchQueue.main.async {
        Settings.shared.appID = appId

        if let token = clientToken, !token.isEmpty {
          Settings.shared.clientToken = token
        }

        Settings.shared.isAdvertiserTrackingEnabled = advertiserTrackingEnabled
        Settings.shared.isAdvertiserIDCollectionEnabled = advertiserTrackingEnabled

        ApplicationDelegate.shared.application(
          UIApplication.shared,
          didFinishLaunchingWithOptions: nil
        )

        promise.resolve(true)
      }
    }

    AsyncFunction("fetchDeferredAppLink") { (promise: Promise) in
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

    AsyncFunction("logMetaEvent") { (eventName: String, valueToSum: Double?, parameters: [String: Any]?, promise: Promise) in
      var params: [AppEvents.ParameterName: Any] = [:]

      if let dict = parameters {
        for (key, value) in dict {
          params[AppEvents.ParameterName(key)] = value
        }
      }

      if let value = valueToSum {
        AppEvents.shared.logEvent(AppEvents.Name(eventName), valueToSum: value, parameters: params)
      } else if params.isEmpty {
        AppEvents.shared.logEvent(AppEvents.Name(eventName))
      } else {
        AppEvents.shared.logEvent(AppEvents.Name(eventName), parameters: params)
      }

      promise.resolve(true)
    }

    AsyncFunction("logMetaPurchase") { (amount: Double, currency: String, parameters: [String: Any]?, promise: Promise) in
      var params: [AppEvents.ParameterName: Any] = [:]

      if let dict = parameters {
        for (key, value) in dict {
          params[AppEvents.ParameterName(key)] = value
        }
      }

      AppEvents.shared.logPurchase(amount: amount, currency: currency, parameters: params)
      promise.resolve(true)
    }

    AsyncFunction("setMetaUserData") { (userData: [String: Any], promise: Promise) in
      AppEvents.shared.setUserData(userData["email"] as? String, forType: .email)
      AppEvents.shared.setUserData(userData["firstName"] as? String, forType: .firstName)
      AppEvents.shared.setUserData(userData["lastName"] as? String, forType: .lastName)
      AppEvents.shared.setUserData(userData["phone"] as? String, forType: .phone)
      AppEvents.shared.setUserData(userData["dateOfBirth"] as? String, forType: .dateOfBirth)
      AppEvents.shared.setUserData(userData["gender"] as? String, forType: .gender)
      AppEvents.shared.setUserData(userData["city"] as? String, forType: .city)
      AppEvents.shared.setUserData(userData["state"] as? String, forType: .state)
      AppEvents.shared.setUserData(userData["zip"] as? String, forType: .zip)
      AppEvents.shared.setUserData(userData["country"] as? String, forType: .country)

      promise.resolve(true)
    }

    AsyncFunction("clearMetaUserData") { (promise: Promise) in
      AppEvents.shared.clearUserData()
      promise.resolve(true)
    }

    AsyncFunction("updateMetaTrackingAuthorization") { (enabled: Bool, promise: Promise) in
      Settings.shared.isAdvertiserTrackingEnabled = enabled
      Settings.shared.isAdvertiserIDCollectionEnabled = enabled
      promise.resolve(true)
    }

    // MARK: - TikTok SDK Methods

    AsyncFunction("initializeTikTokSDK") { (appId: String, tiktokAppId: String, accessToken: String?, debug: Bool, promise: Promise) in
      DispatchQueue.main.async {
        let config: TikTokConfig?
        if let token = accessToken, !token.isEmpty {
          config = TikTokConfig(accessToken: token, appId: appId, tiktokAppId: tiktokAppId)
        } else {
          config = TikTokConfig(appId: appId, tiktokAppId: tiktokAppId)
        }

        if debug {
          config?.setLogLevel(.verbose)
        }

        if let validConfig = config {
          TikTokBusiness.initializeSdk(validConfig)
          promise.resolve(true)
        } else {
          promise.reject("tiktok_init_error", "Failed to create TikTok config")
        }
      }
    }

    AsyncFunction("trackTikTokEvent") { (eventName: String, eventId: String?, properties: [String: Any]?, promise: Promise) in
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

      TikTokBusiness.trackTTEvent(event)
      promise.resolve(true)
    }

    AsyncFunction("identifyTikTokUser") { (externalId: String, externalUserName: String, phoneNumber: String, email: String, promise: Promise) in
      TikTokBusiness.identify(
        withExternalID: externalId.isEmpty ? nil : externalId,
        externalUserName: externalUserName.isEmpty ? nil : externalUserName,
        phoneNumber: phoneNumber.isEmpty ? nil : phoneNumber,
        email: email.isEmpty ? nil : email
      )
      promise.resolve(true)
    }

    AsyncFunction("logoutTikTok") { (promise: Promise) in
      TikTokBusiness.logout()
      promise.resolve(true)
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
