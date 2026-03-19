require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = "datalyr-react-native"
  s.version      = package['version']
  s.summary      = package['description']
  s.description  = <<-DESC
    Datalyr SDK for React Native with server-side attribution tracking.
    Provides event capture, Apple Search Ads attribution, and Play Install
    Referrer support. Conversion routing handled server-side via postback.
  DESC
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.author       = package['author']
  s.platform     = :ios, "13.0"
  s.source       = { :git => package['repository']['url'], :tag => "v#{s.version}" }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.swift_version = "5.0"

  s.dependency "ExpoModulesCore"

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
