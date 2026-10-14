// swift-tools-version:5.9
// oma-vmhelper: the one signed binary that touches Virtualization.framework
// and the Keychain (macos-platform §2.1, MAC-701). NOT_BUILT on the Linux
// development host; built and tested on a Mac (mac-unit, mac-vm lanes).
import PackageDescription

let package = Package(
  name: "oma-vmhelper",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "oma-vmhelper", path: "Sources/oma-vmhelper",
      linkerSettings: [.linkedFramework("Virtualization"), .linkedFramework("Security"), .linkedFramework("AppKit")]),
  ]
)
