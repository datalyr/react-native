require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = "datalyr-react-native"
  s.version      = package['version']
  s.summary      = package['description']
  s.description  = <<-DESC
    Datalyr SDK for React Native with bundled Meta (Facebook) and TikTok SDKs.
    Provides deferred deep linking, event forwarding, and advanced attribution
    without requiring users to install additional packages.
  DESC
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.author       = package['author']
  s.platform     = :ios, "13.0"
  s.source       = { :git => package['repository']['url'], :tag => "v#{s.version}" }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.swift_version = "5.0"

  s.dependency "React-Core"
  s.dependency "FBSDKCoreKit", "~> 17.0"
  s.dependency "TikTokBusinessSDK", "~> 1.4"

  # Disable bitcode (required for TikTok SDK)
  s.pod_target_xcconfig = {
    'ENABLE_BITCODE' => 'NO',
    'DEFINES_MODULE' => 'YES'
  }
end
