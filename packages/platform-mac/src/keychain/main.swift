// Credential primitive only. No application, VM, policy or storage engine.
import Darwin
import Foundation
import Security

let channel = FileHandle(fileDescriptor: 3, closeOnDealloc: false)
let output = DispatchQueue(label: "oma.keychain.responses")
func send(_ message: [String: Any]) {
  output.sync {
    guard let bytes = try? JSONSerialization.data(withJSONObject: message) else { exit(2) }
    channel.write(bytes); channel.write(Data([10]))
  }
}
func answer(_ id: Int, _ fields: [String: Any] = [:]) {
  var result = fields; result["id"] = id; result["ok"] = true; send(result)
}
func refuse(_ id: Int, _ message: String) { send(["id": id, "ok": false, "error": message]) }
func query(_ account: String) -> [String: Any] {
  return [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "io.github.minjung2035.oma.provider",
    kSecAttrAccount as String: account,
    kSecUseDataProtectionKeychain as String: true,
    kSecAttrSynchronizable as String: false]
}
func get(_ id: Int, _ account: String) {
  var request = query(account)
  request[kSecReturnData as String] = true
  request[kSecMatchLimit as String] = kSecMatchLimitOne
  var item: CFTypeRef?
  let status = SecItemCopyMatching(request as CFDictionary, &item)
  if status == errSecItemNotFound { answer(id); return }
  guard status == errSecSuccess, let data = item as? Data,
    let value = String(data: data, encoding: .utf8) else {
    refuse(id, "The Keychain could not be read (status \(status))"); return
  }
  answer(id, ["value": value])
}
func put(_ id: Int, _ account: String, _ value: String) {
  let data = Data(value.utf8), request = query(account)
  var status = SecItemUpdate(request as CFDictionary, [kSecValueData as String: data] as CFDictionary)
  if status == errSecItemNotFound {
    var add = request; add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    status = SecItemAdd(add as CFDictionary, nil)
  }
  if status == errSecSuccess { answer(id) }
  else { refuse(id, "The Keychain could not be written (status \(status))") }
}
guard CommandLine.arguments.count == 1 else { exit(2) }
withUnsafeTemporaryAllocation(of: UInt8.self, capacity: 65536) { input in
  let buffer = input.baseAddress!, descriptor = channel.fileDescriptor
  var received = Data()
  while true {
    // A stream request must be answered before its supervision channel ends.
    let count = Darwin.read(descriptor, buffer, input.count)
    if count < 0 {
      if errno == EINTR { continue }
      exit(2)
    }
    if count == 0 { exit(received.isEmpty ? 0 : 2) }
    received.append(buffer, count: count)
    if received.count > 1024 * 1024 { exit(2) }
    while let newline = received.firstIndex(of: 10) {
      let bytes = received.subdata(in: received.startIndex..<newline)
      received.removeSubrange(received.startIndex...newline)
      guard let request = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
        let id = request["id"] as? Int, let operation = request["op"] as? String,
        let account = request["account"] as? String else { exit(2) }
      switch operation {
      case "keychain.get":
        guard Set(request.keys) == Set(["id", "op", "account"]) else { exit(2) }
        get(id, account)
      case "keychain.put":
        guard Set(request.keys) == Set(["id", "op", "account", "value"]), let value = request["value"] as? String else { exit(2) }
        put(id, account, value)
      default: refuse(id, "Unknown credential operation")
      }
    }
  }
}
