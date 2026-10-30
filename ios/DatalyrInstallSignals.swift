import Foundation
import StoreKit
import Darwin

/// First-launch install signals for the JS classifier (src/install-classifier.ts),
/// the same reads as the iOS SDK 2.2.0 DeviceInstallSignals: whether files the app
/// wrote predate this process, the bundle vs data-container dates, and the App Store
/// record (AppTransaction, iOS 16+, production only, 3s cap, never refresh()).
/// Raw dates go to JS only to be bucketed there; they are never sent.
enum DatalyrInstallSignals {
  static func read() async -> [String: Any] {
    var result: [String: Any] = [:]
    let fileManager = FileManager.default
    let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first
    let containerCreatedAt = library.flatMap { creationDate($0) }
    if let containerCreatedAt { result["containerCreatedAtMs"] = containerCreatedAt.timeIntervalSince1970 * 1000 }
    if let processStart = processStartDate() {
      let cutoff = processStart.addingTimeInterval(-1)
      let earliest = appWrittenItems().compactMap { creationDate($0) }.filter { $0 < cutoff }.min()
      result["ranBefore"] = earliest != nil
      result["processStartMs"] = processStart.timeIntervalSince1970 * 1000
      if let earliest { result["earliestEvidenceMs"] = earliest.timeIntervalSince1970 * 1000 }
    }
    if let bundleDate = creationDate(Bundle.main.bundleURL), let containerCreatedAt {
      result["bundleNewerThanContainer"] = bundleDate > containerCreatedAt.addingTimeInterval(3600)
    }
    if let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String { result["currentBuild"] = build }
    if let store = await storeRecord() {
      result["storeOriginalAppVersion"] = store.version
      result["storeOriginalPurchaseDateMs"] = store.purchased.timeIntervalSince1970 * 1000
    }
    return result
  }

  /// Items only a run of the app creates. Folders first: their creation date is stable,
  /// while files saved atomically (the preferences plist included) get a new one on every
  /// save. Never Library, Caches or Documents themselves, which the system creates at
  /// install time. Caches can be purged, which only hides evidence.
  static func appWrittenItems() -> [URL] {
    let fileManager = FileManager.default
    var urls: [URL] = []
    let bundleId = Bundle.main.bundleIdentifier
    if let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first {
      for path in ["WebKit", "Cookies"] { urls.append(library.appendingPathComponent(path)) }
      if let bundleId {
        urls.append(library.appendingPathComponent("HTTPStorages/\(bundleId)"))
        urls.append(library.appendingPathComponent("Preferences/\(bundleId).plist"))
      }
    }
    if let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first, let bundleId {
      urls.append(caches.appendingPathComponent(bundleId))
    }
    for directory in [FileManager.SearchPathDirectory.documentDirectory, .applicationSupportDirectory] {
      guard let root = fileManager.urls(for: directory, in: .userDomainMask).first,
            let children = try? fileManager.contentsOfDirectory(at: root, includingPropertiesForKeys: [.creationDateKey],
                                                                 options: [.skipsHiddenFiles]) else { continue }
      urls.append(contentsOf: children.prefix(50))
    }
    return urls
  }

  static func creationDate(_ url: URL) -> Date? {
    (try? url.resourceValues(forKeys: [.creationDateKey]))?.creationDate
  }

  static func processStartDate() -> Date? {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0, size > 0 else { return nil }
    let start = info.kp_proc.p_un.__p_starttime
    let seconds = TimeInterval(start.tv_sec) + TimeInterval(start.tv_usec) / 1_000_000
    return seconds > 0 ? Date(timeIntervalSince1970: seconds) : nil
  }

  /// AppTransaction.shared, production only. Never refresh() (an App Store sign-in
  /// prompt). The call runs in its own task and the caller resumes at 3s whether or not
  /// StoreKit answered: a task group would wait for a StoreKit child that ignores cancellation.
  static func storeRecord() async -> (version: String, purchased: Date)? {
    guard #available(iOS 16.0, *) else { return nil }
    return await withCheckedContinuation { (continuation: CheckedContinuation<(version: String, purchased: Date)?, Never>) in
      let once = ResumeOnce(continuation)
      let worker = Task {
        guard let result = try? await AppTransaction.shared else { once.resume(nil); return }
        let transaction: AppTransaction
        switch result {
        case .verified(let value), .unverified(let value, _): transaction = value
        }
        guard transaction.environment == .production else { once.resume(nil); return }
        once.resume((transaction.originalAppVersion, transaction.originalPurchaseDate))
      }
      Task {
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        worker.cancel()
        once.resume(nil)
      }
    }
  }
}

/// Resumes a continuation exactly once, from whichever side answers first.
private final class ResumeOnce<T>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T?, Never>?
  init(_ continuation: CheckedContinuation<T?, Never>) { self.continuation = continuation }
  func resume(_ value: T?) {
    lock.lock()
    let pending = continuation
    continuation = nil
    lock.unlock()
    pending?.resume(returning: value)
  }
}
