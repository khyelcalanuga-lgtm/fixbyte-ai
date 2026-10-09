# FixByte AI Android APK

The APK bundles the app interface and calls the hosted server at `https://fixbyte-ai.expo.app` (EAS Hosting) for AI chat and repair-shop searches. It works on any network; no computer needs to be running. Provider API keys live on the server as EAS secret variables; never use `EXPO_PUBLIC_` for secrets.

## Install on your phone

Copy `artifacts/FixByte-AI.apk` to your phone, open it, and allow installation from that source when Android asks.

This APK is signed with the generated Android test key. It is intended for direct installation and testing. Chat and shop search need an internet connection.

## Server

The server is the Expo Router API routes (`app/api/*`), deployed with EAS Hosting to project `@khyell/fixbyte-ai`. `GET /api/health` checks it is up.

Redeploy after changing anything under `app/api/`:

```powershell
npx expo export --platform web
.cloud-tools/node_modules/.bin/eas deploy --prod --environment production
```

The API keys are the `production` EAS environment variables `GEMINI_API_KEY` and `OPENROUTER_API_KEY` (secret visibility). Change one with:

```powershell
.cloud-tools/node_modules/.bin/eas env:create production --name GEMINI_API_KEY --value <key> --visibility secret --force
```

then redeploy. The local `.env` is only used by `npm start`.

The server URL is public, so anyone who finds it can use the AI quota behind these keys.

## Rebuild the APK

Requires installed npm dependencies, a compatible JDK (Android Studio's bundled JDK is detected), and the Android SDK. Gradle may download missing build dependencies.

The script downloads Ninja 1.13.1 from its official GitHub release into `.android-tools/` and selects it only for this project's build. This avoids a Windows long-path failure with Android's older Ninja. Build concurrency and JVM memory are also configured in the script.

```powershell
npm run build:apk
```

It reads the server URL from `app.json` (`expo.extra.apiUrl`) and only accepts a hosted HTTPS URL; `-ApiUrl https://...` overrides it. Bump `expo.version` and `expo.android.versionCode` in `app.json` for each APK you hand out, so it installs over the previous one. Native files are generated in the ignored `android/` directory. The app ID is `com.fixbyte.ai`.

A Play Store release additionally needs a private production signing key, an Android App Bundle, and release configuration.
