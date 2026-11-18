import Foundation
import Security

struct ImportFailure: Error {}
func checked(_ status: OSStatus) throws {
    guard status == errSecSuccess else { throw ImportFailure() }
}

func importIdentity() throws {
    guard CommandLine.arguments.count == 2,
          let encoded = ProcessInfo.processInfo.environment["MACOS_SIGNING_CERTIFICATE_P12_BASE64"],
          let password = ProcessInfo.processInfo.environment["MACOS_SIGNING_CERTIFICATE_PASSWORD"],
          let certificate = Data(base64Encoded: encoded), !certificate.isEmpty else { throw ImportFailure() }
    let destination = CommandLine.arguments[1]
    guard !FileManager.default.fileExists(atPath: destination) else { throw ImportFailure() }
    var originalSearch: CFArray?
    try checked(SecKeychainCopySearchList(&originalSearch))
    guard let originalSearch else { throw ImportFailure() }
    var failure: Error?
    do {
        var keychain: SecKeychain?
        try checked(SecKeychainCreate(destination, 0, nil, false, nil, &keychain))
        guard let keychain else { throw ImportFailure() }
        try checked(SecKeychainUnlock(keychain, 0, nil, true))
        var trusted: SecTrustedApplication?
        try checked(SecTrustedApplicationCreateFromPath("/usr/bin/codesign", &trusted))
        guard let trusted else { throw ImportFailure() }
        var access: SecAccess?
        try checked(SecAccessCreate("HQ ephemeral signing" as CFString, [trusted] as CFArray, &access))
        guard let access else { throw ImportFailure() }
        let options: [String: Any] = [
            kSecImportExportPassphrase as String: password,
            kSecImportExportKeychain as String: keychain,
            kSecImportExportAccess as String: access,
        ]
        var items: CFArray?
        try checked(SecPKCS12Import(certificate as CFData, options as CFDictionary, &items))
        guard let items, CFArrayGetCount(items) == 1 else { throw ImportFailure() }
    } catch { failure = error }
    try checked(SecKeychainSetSearchList(originalSearch))
    if let failure { throw failure }
}

do { try importIdentity() }
catch { fputs("Signing identity import failed; no credential details emitted.\n", stderr); exit(1) }
