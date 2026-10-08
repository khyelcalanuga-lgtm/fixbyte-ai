# FixByte AI Android APK

The APK bundles the app interface and uses a separate server for AI chat and repair-shop searches. Provider API keys stay in the server's `.env`; never use `EXPO_PUBLIC_` for secrets.

## Test on your phone

The initial test APK connects to `http://192.168.1.192:8081`. Keep the computer and phone on the same local network.

1. In this project, run `npm run server:export`, then `npm run server:start`. Keep the server running. Existing Gemini/OpenRouter keys in `.env` are used by the server.
2. Check that `http://192.168.1.192:8081` opens in the phone's browser. If Windows prompts for firewall access, allow the server on your private network.
3. Copy `artifacts/FixByte-AI-test.apk` to your phone, open it, and allow installation from that source when Android asks.

If this app is already running through `npm start` on port 8081, you can use that server directly. Do not start a second server on the same port.

This APK is signed with the generated Android test key. It is intended for direct installation and testing. Chat and shop search need the server; they do not run offline.

## Rebuild

Requires installed npm dependencies, a compatible JDK (Android Studio's bundled JDK is detected), and the Android SDK. Gradle may download missing build dependencies.

The script downloads Ninja 1.13.1 from its official GitHub release into `.android-tools/` and selects it only for this project's build. This avoids a Windows long-path failure with Android's older Ninja. Build concurrency and JVM memory are also configured in the script.

```powershell
npm run build:apk -- -ApiUrl http://192.168.1.192:8081
```

Use the computer's current LAN address if it changes. Native files are generated in the ignored `android/` directory. The app ID is `com.fixbyte.ai`; version is `1.0.0` (code 1).

For access away from this network, host the Expo server with the provider keys configured, then rebuild with its HTTPS URL:

```powershell
npm run build:apk -- -ApiUrl https://your-app.example.com
```

HTTP is allowed only in builds explicitly configured with an HTTP API URL. A Play Store release additionally needs a private production signing key, an Android App Bundle, and release configuration.
