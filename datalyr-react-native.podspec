require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = "datalyr-react-native"
  s.version      = package['version']
  s.summary      = package['description']
  s.description  = <<-DESC
    DATALYR SDK for React Native and Expo. Captures events and attribution,
    including Apple Search Ads, SKAdNetwork and the Play Install Referrer.
  DESC
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.author       = package['author']
  s.platform     = :ios, "13.0"
  s.source       = { :git => package['repository']['url'], :tag => "v#{s.version}" }
  s.source_files = "ios/**/*.{h,m,swift}"
  # Ship the privacy manifest (tracking domains + accessed-API reasons).
  s.resource_bundles = { "DatalyrReactNativePrivacy" => ["ios/PrivacyInfo.xcprivacy"] }
  s.frameworks = ["AdSupport", "AppTrackingTransparency", "StoreKit"]
  s.weak_frameworks = ["AdServices", "AdAttributionKit"]
  s.swift_version = "5.0"

  s.dependency "ExpoModulesCore"

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
