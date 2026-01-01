import Foundation
import FBSDKCoreKit
import TikTokBusinessSDK

@objc(DatalyrNative)
class DatalyrNative: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  // MARK: - Meta (Facebook) SDK Methods

  @objc func initializeMetaSDK(
    _ appId: String,
    clientToken: String?,
    advertiserTrackingEnabled: Bool,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
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

      resolve(true)
    }
  }

  @objc func fetchDeferredAppLink(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    AppLinkUtility.fetchDeferredAppLink { url, error in
      if error != nil {
        // Don't reject - deferred deep link not available is expected in many cases
        // Error is normal when no deferred link exists
        resolve(nil)
        return
      }

      if let url = url {
        resolve(url.absoluteString)
      } else {
        resolve(nil)
      }
    }
  }

  @objc func logMetaEvent(
    _ eventName: String,
    valueToSum: NSNumber?,
    parameters: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    var params: [AppEvents.ParameterName: Any] = [:]

    if let dict = parameters as? [String: Any] {
      for (key, value) in dict {
        params[AppEvents.ParameterName(key)] = value
      }
    }

    if let value = valueToSum?.doubleValue {
      AppEvents.shared.logEvent(AppEvents.Name(eventName), valueToSum: value, parameters: params)
    } else if params.isEmpty {
      AppEvents.shared.logEvent(AppEvents.Name(eventName))
    } else {
      AppEvents.shared.logEvent(AppEvents.Name(eventName), parameters: params)
    }

    resolve(true)
  }

  @objc func logMetaPurchase(
    _ amount: Double,
    currency: String,
    parameters: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    var params: [AppEvents.ParameterName: Any] = [:]

    if let dict = parameters as? [String: Any] {
      for (key, value) in dict {
        params[AppEvents.ParameterName(key)] = value
      }
    }

    AppEvents.shared.logPurchase(amount: amount, currency: currency, parameters: params)
    resolve(true)
  }

  @objc func setMetaUserData(
    _ userData: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    AppEvents.shared.setUserData(
      userData["email"] as? String,
      forType: .email
    )
    AppEvents.shared.setUserData(
      userData["firstName"] as? String,
      forType: .firstName
    )
    AppEvents.shared.setUserData(
      userData["lastName"] as? String,
      forType: .lastName
    )
    AppEvents.shared.setUserData(
      userData["phone"] as? String,
      forType: .phone
    )
    AppEvents.shared.setUserData(
      userData["dateOfBirth"] as? String,
      forType: .dateOfBirth
    )
    AppEvents.shared.setUserData(
      userData["gender"] as? String,
      forType: .gender
    )
    AppEvents.shared.setUserData(
      userData["city"] as? String,
      forType: .city
    )
    AppEvents.shared.setUserData(
      userData["state"] as? String,
      forType: .state
    )
    AppEvents.shared.setUserData(
      userData["zip"] as? String,
      forType: .zip
    )
    AppEvents.shared.setUserData(
      userData["country"] as? String,
      forType: .country
    )

    resolve(true)
  }

  @objc func clearMetaUserData(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    AppEvents.shared.clearUserData()
    resolve(true)
  }

  @objc func updateMetaTrackingAuthorization(
    _ enabled: Bool,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Settings.shared.isAdvertiserTrackingEnabled = enabled
    Settings.shared.isAdvertiserIDCollectionEnabled = enabled
    resolve(true)
  }

  // MARK: - TikTok SDK Methods

  @objc func initializeTikTokSDK(
    _ appId: String,
    tiktokAppId: String,
    accessToken: String?,
    debug: Bool,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let config = TikTokConfig(appId: appId, tiktokAppId: tiktokAppId)

      if let token = accessToken, !token.isEmpty {
        config?.accessToken = token
      }

      if debug {
        config?.setLogLevel(.debug)
      }

      if let validConfig = config {
        TikTokBusiness.initializeSdk(validConfig)
        resolve(true)
      } else {
        reject("tiktok_init_error", "Failed to create TikTok config", nil)
      }
    }
  }

  @objc func trackTikTokEvent(
    _ eventName: String,
    eventId: String?,
    properties: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    // Use TikTokBaseEvent for modern API (trackEvent methods are deprecated)
    let event: TikTokBaseEvent

    if let eid = eventId, !eid.isEmpty {
      event = TikTokBaseEvent(eventName: eventName, eventId: eid)
    } else {
      event = TikTokBaseEvent(eventName: eventName)
    }

    // Add properties to the event
    if let dict = properties as? [String: Any] {
      for (key, value) in dict {
        event.addProperty(withKey: key, value: value)
      }
    }

    TikTokBusiness.trackTTEvent(event)
    resolve(true)
  }

  @objc func identifyTikTokUser(
    _ externalId: String,
    externalUserName: String,
    phoneNumber: String,
    email: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    // Method signature: identifyWithExternalID:externalUserName:phoneNumber:email:
    TikTokBusiness.identify(
      withExternalID: externalId.isEmpty ? nil : externalId,
      externalUserName: externalUserName.isEmpty ? nil : externalUserName,
      phoneNumber: phoneNumber.isEmpty ? nil : phoneNumber,
      email: email.isEmpty ? nil : email
    )
    resolve(true)
  }

  @objc func logoutTikTok(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    TikTokBusiness.logout()
    resolve(true)
  }

  @objc func updateTikTokTrackingAuthorization(
    _ enabled: Bool,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    // TikTok SDK handles ATT automatically, but we track the change
    resolve(true)
  }

  // MARK: - SDK Availability Check

  @objc func getSDKAvailability(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve([
      "meta": true,
      "tiktok": true
    ])
  }
}
