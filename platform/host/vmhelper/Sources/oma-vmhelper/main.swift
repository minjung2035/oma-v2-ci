// oma-vmhelper (macos-platform §2.1, §5.2, MAC-201..205, MAC-302, MAC-701).
//
// NOT_BUILT: written on a Linux host and not yet compiled or run. The
// protocol it speaks is the one src/platform/host/vz-driver.ts speaks and
// test/platform-vz-driver.test.ts pins; see README.md.
//
// The VM runs inside this process. Descriptor 3 is omahostd's channel; when
// it closes, the VM is stopped and the helper exits, so the VM never outlives
// omahostd (§9.3).

import AppKit
import Darwin
import Foundation
import Security
import Virtualization

// This one-shot path exits before the VM/control channel is constructed.
if CommandLine.arguments.dropFirst().contains("--project-bookmark") {
  guard CommandLine.arguments.dropFirst().elementsEqual(["--project-bookmark"]) else { exit(2) }
  do {
    var input = Data()
    while true {
      let part = FileHandle.standardInput.readData(ofLength: min(65536, 1024 * 1024 + 1 - input.count))
      if part.isEmpty { break }
      input.append(part)
      guard input.count <= 1024 * 1024 else { exit(2) }
    }
    guard let request = try JSONSerialization.jsonObject(with: input) as? [String: String]
    else { exit(2) }
    let reply: [String: String]
    switch request["op"] {
    case "create":
      guard Set(request.keys) == Set(["op", "path"]), let path = request["path"], path.hasPrefix("/") else { exit(2) }
      let url = URL(fileURLWithPath: path, isDirectory: true)
      let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
      reply = ["bookmark": data.base64EncodedString()]
    case "resolve":
      guard Set(request.keys) == Set(["op", "bookmark"]), let text = request["bookmark"],
            let data = Data(base64Encoded: text) else { exit(2) }
      var stale = false
      let url = try URL(resolvingBookmarkData: data, options: [.withoutUI, .withoutMounting],
                        relativeTo: nil, bookmarkDataIsStale: &stale)
      guard url.isFileURL else { exit(2) }
      reply = ["path": url.path]
    default: exit(2)
    }
    let output = try JSONSerialization.data(withJSONObject: reply)
    guard output.count <= 1024 * 1024 else { exit(2) }
    FileHandle.standardOutput.write(output)
    exit(0)
  } catch { exit(1) }
}

// MARK: - The channel (descriptor 3, JSON lines)

// Personal uses the same signed Keychain code without admitting VM commands.
let keychainOnly = CommandLine.arguments.dropFirst().contains("--keychain-only")
let channelQueue = DispatchQueue(label: "oma.vmhelper.channel")
let channel = FileHandle(fileDescriptor: 3, closeOnDealloc: false)

func send(_ message: [String: Any]) {
  channelQueue.async {
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    channel.write(data)
    channel.write(Data([0x0a]))
  }
}
func answer(_ id: Int, _ fields: [String: Any] = [:]) {
  var message = fields
  message["id"] = id
  message["ok"] = true
  send(message)
}
func refuse(_ id: Int, _ error: String) { send(["id": id, "ok": false, "error": error]) }

// MARK: - The VM

let vmQueue = DispatchQueue(label: "oma.vmhelper.vm")
var machine: VZVirtualMachine?
var bridges: [PortBridge] = []

final class Delegate: NSObject, VZVirtualMachineDelegate {
  func guestDidStop(_ virtualMachine: VZVirtualMachine) {
    stopBridges()
    send(["event": "stopped", "cause": "guest"])
  }
  func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
    stopBridges()
    send(["event": "stopped", "cause": "error", "message": "the engine stopped unexpectedly"])
  }
}
let delegate = Delegate()

struct VmConfig {
  let kernel: String, initrd: String, cmdline: String
  let disks: [(path: String, readOnly: Bool)]
  let cpus: Int, memoryBytes: UInt64, consoleLog: String
  let ports: [UInt32], socketDir: String

  init?(_ value: Any?) {
    guard let c = value as? [String: Any],
      let kernel = c["kernel"] as? String, let initrd = c["initrd"] as? String, let cmdline = c["cmdline"] as? String,
      let disks = c["disks"] as? [[String: Any]], let cpus = c["cpus"] as? Int, let memory = c["memoryBytes"] as? NSNumber,
      let consoleLog = c["consoleLog"] as? String, let ports = c["ports"] as? [NSNumber], let socketDir = c["socketDir"] as? String
    else { return nil }
    var parsed: [(String, Bool)] = []
    for disk in disks {
      guard let path = disk["path"] as? String, let readOnly = disk["readOnly"] as? Bool else { return nil }
      parsed.append((path, readOnly))
    }
    self.kernel = kernel; self.initrd = initrd; self.cmdline = cmdline; self.disks = parsed
    self.cpus = cpus; self.memoryBytes = memory.uint64Value; self.consoleLog = consoleLog
    self.ports = ports.map { $0.uint32Value }; self.socketDir = socketDir
  }
}

func configuration(_ config: VmConfig) throws -> VZVirtualMachineConfiguration {
  let c = VZVirtualMachineConfiguration()
  c.platform = VZGenericPlatformConfiguration()
  let boot = VZLinuxBootLoader(kernelURL: URL(fileURLWithPath: config.kernel))
  boot.initialRamdiskURL = URL(fileURLWithPath: config.initrd)
  boot.commandLine = config.cmdline
  c.bootLoader = boot
  c.cpuCount = config.cpus
  c.memorySize = config.memoryBytes
  for disk in config.disks {
    // MAC-302: the state disk only with full synchronization, so a guest
    // flush reaches F_FULLFSYNC; the read-only system parts need none.
    let attachment = try VZDiskImageStorageDeviceAttachment(
      url: URL(fileURLWithPath: disk.path), readOnly: disk.readOnly,
      cachingMode: .uncached, synchronizationMode: disk.readOnly ? .none : .full)
    c.storageDevices.append(VZVirtioBlockDeviceConfiguration(attachment: attachment))
  }
  let console = VZVirtioConsoleDeviceSerialPortConfiguration()
  console.attachment = try VZFileSerialPortAttachment(url: URL(fileURLWithPath: config.consoleLog), append: true)
  c.serialPorts = [console]
  c.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
  c.memoryBalloonDevices = [VZVirtioTraditionalMemoryBalloonDeviceConfiguration()]
  c.socketDevices = [VZVirtioSocketDeviceConfiguration()]
  // MAC-203, MAC-005: no network device and no shared directory.
  try c.validate()
  return c
}

func start(_ id: Int, _ config: VmConfig) {
  vmQueue.async {
    if machine != nil { refuse(id, "the engine is already running"); return }
    let vm: VZVirtualMachine
    do { vm = VZVirtualMachine(configuration: try configuration(config), queue: vmQueue) }
    catch { refuse(id, "the engine could not be configured"); return }
    vm.delegate = delegate
    vm.start { result in
      switch result {
      case .success:
        machine = vm
        guard let device = vm.socketDevices.first as? VZVirtioSocketDevice else { refuse(id, "the engine has no channel"); return }
        do {
          // MAC-201: the host never listens on vsock; it only connects out.
          bridges = try config.ports.map { try PortBridge(port: $0, path: "\(config.socketDir)/port-\($0).sock", device: device) }
          answer(id)
        } catch { refuse(id, "the engine's channel could not be opened") }
      case .failure:
        refuse(id, "the engine did not start")
      }
    }
  }
}

func forceStop(_ id: Int) {
  vmQueue.async {
    guard let vm = machine else { answer(id); return }
    vm.stop { _ in
      machine = nil
      stopBridges()
      answer(id)
      send(["event": "stopped", "cause": "error"])
    }
  }
}

func stopBridges() {
  for bridge in bridges { bridge.close() }
  bridges = []
  machine = nil
}

// MARK: - Ports (vfkit's connect mode)

/// Listens on a unix socket; each connection accepted there becomes one vsock
/// connection to the guest's port, relayed both ways until either side ends.
final class PortBridge {
  let listener: Int32
  let path: String
  private var open = true

  init(port: UInt32, path: String, device: VZVirtioSocketDevice) throws {
    self.path = path
    unlink(path)
    listener = socket(AF_UNIX, SOCK_STREAM, 0)
    guard listener >= 0 else { throw POSIXError(.EIO) }
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else { close(); throw POSIXError(.ENAMETOOLONG) }
    withUnsafeMutableBytes(of: &address.sun_path) { raw in
      for (index, byte) in bytes.enumerated() { raw[index] = byte }
      raw[bytes.count] = 0
    }
    let bound = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    guard bound == 0, chmod(path, 0o600) == 0, listen(listener, 64) == 0 else { close(); throw POSIXError(.EIO) }
    let thread = Thread { [weak self] in self?.acceptLoop(port: port, device: device) }
    thread.start()
  }

  private func acceptLoop(port: UInt32, device: VZVirtioSocketDevice) {
    while open {
      let client = accept(listener, nil, nil)
      if client < 0 { if errno == EINTR { continue }; return }
      // Only omahostd, which runs as this user, may use the port (the
      // directory is the host's 0700 run directory).
      vmQueue.async {
        device.connect(toPort: port) { result in
          switch result {
          case .success(let connection): relay(client, connection)
          case .failure: Darwin.close(client)
          }
        }
      }
    }
  }

  func close() {
    open = false
    shutdown(listener, SHUT_RDWR)
    Darwin.close(listener)
    unlink(path)
  }
}

/// Copies bytes both ways; an end on one side is passed on as a half-close.
func relay(_ client: Int32, _ connection: VZVirtioSocketConnection) {
  let guest = connection.fileDescriptor
  let pending = DispatchGroup()
  for (from, to) in [(client, guest), (guest, client)] {
    pending.enter()
    Thread {
      var buffer = [UInt8](repeating: 0, count: 64 * 1024)
      copying: while true {
        let count = read(from, &buffer, buffer.count)
        if count < 0 && errno == EINTR { continue }
        if count <= 0 { break }
        var written = 0
        while written < count {
          let n = buffer.withUnsafeBytes { write(to, $0.baseAddress! + written, count - written) }
          if n < 0 && errno == EINTR { continue }
          if n <= 0 { break copying }
          written += n
        }
      }
      shutdown(to, SHUT_WR)
      pending.leave()
    }.start()
  }
  pending.notify(queue: .global()) {
    Darwin.close(client)
    connection.close()
  }
}

// MARK: - Keychain (MAC-701)

let keychainService = ProcessInfo.processInfo.environment["OMA_KEYCHAIN_SERVICE"] ?? "io.github.minjung2035.oma.provider"
let keychainGroup = ProcessInfo.processInfo.environment["OMA_KEYCHAIN_GROUP"]

func keychainQuery(_ account: String) -> [String: Any] {
  var query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: keychainService,
    kSecAttrAccount as String: account,
    // Only the data protection keychain honours accessibility and access groups.
    kSecUseDataProtectionKeychain as String: true,
    kSecAttrSynchronizable as String: false,
  ]
  if let group = keychainGroup { query[kSecAttrAccessGroup as String] = group }
  return query
}

func keychainGet(_ id: Int, _ account: String) {
  var query = keychainQuery(account)
  query[kSecReturnData as String] = true
  query[kSecMatchLimit as String] = kSecMatchLimitOne
  var item: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &item)
  if status == errSecItemNotFound { answer(id); return }
  // MAC-702: a locked or unreadable Keychain is an error, not an empty item.
  guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
    refuse(id, "the keychain could not be read"); return
  }
  answer(id, ["value": value])
}

func keychainPut(_ id: Int, _ account: String, _ value: String) {
  let data = Data(value.utf8)
  let query = keychainQuery(account)
  let update: [String: Any] = [kSecValueData as String: data]
  var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
  if status == errSecItemNotFound {
    var add = query
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    status = SecItemAdd(add as CFDictionary, nil)
  }
  if status == errSecSuccess { answer(id) } else { refuse(id, "the keychain could not be written") }
}

// MARK: - Sleep and wake (§9.1)

if !keychainOnly {
  let workspace = NSWorkspace.shared.notificationCenter
  workspace.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: nil) { _ in send(["event": "sleep"]) }
  workspace.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: nil) { _ in send(["event": "wake"]) }
}

// MARK: - Main loop

var received = Data()
channel.readabilityHandler = { handle in
  let chunk = handle.availableData
  if chunk.isEmpty {
    // omahostd is gone: the VM goes with this process (§9.3).
    handle.readabilityHandler = nil
    vmQueue.async {
      if let vm = machine { vm.stop { _ in exit(0) } } else { exit(0) }
    }
    return
  }
  received.append(chunk)
  if received.count > 1024 * 1024 { exit(2) }
  while let newline = received.firstIndex(of: 0x0a) {
    let line = received.subdata(in: received.startIndex..<newline)
    received.removeSubrange(received.startIndex...newline)
    guard let request = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
      let op = request["op"] as? String, let id = request["id"] as? Int
    else { exit(2) }
    if keychainOnly && op != "keychain.get" && op != "keychain.put" {
      refuse(id, "the Keychain channel does not run an engine")
      continue
    }
    switch op {
    case "start":
      guard let config = VmConfig(request["config"]) else { refuse(id, "the engine's configuration is invalid"); continue }
      start(id, config)
    case "forceStop": forceStop(id)
    case "keychain.get":
      guard let account = request["account"] as? String else { refuse(id, "no account"); continue }
      keychainGet(id, account)
    case "keychain.put":
      guard let account = request["account"] as? String, let value = request["value"] as? String else { refuse(id, "no account or value"); continue }
      keychainPut(id, account, value)
    default: refuse(id, "unknown op")
    }
  }
}

RunLoop.main.run()
