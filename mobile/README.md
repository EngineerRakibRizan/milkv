# Aura Dairy — mobile staff app (Flutter)

Native Android and iOS client for the FarmOS API in [`../backend`](../backend). It
covers:

- **Daily work:** dashboard, the milk sheet, the delivery route, customers and
  payments, website leads, tasks and notifications.
- **Operations (More):** Feed & Inventory (stock, low-stock, movements, feed
  used, stock count, items, purchases) and Veterinary (treatments with
  prescribed medication, vaccinations, upcoming due dates).
- **Finance (More):** Income (sales, invoices, money received, record sale,
  void), Expenses (bills, pay, void, new expense/purchase/asset), Suppliers
  (dues, bills, payments, pay, add/edit) and Accounting & Reports (profit &
  loss with ledger drill-down, cash flow, customer and supplier dues, profit
  by business area and per cow/flock, milk and feed).

Still only on the web app: livestock and poultry records, employees and
salaries, settings, backups and the public landing page.

- **Offline-first.** Every screen opens instantly from the last saved response,
  then refreshes from the server. Writes made without a connection are kept on
  the phone and sent in order when it returns.
- **Idempotent writes.** Each user action gets one `Idempotency-Key` (UUID). It
  is reused on every retry and replay, and the server returns the first
  response for a repeated key, so a double tap or an offline replay can never
  create a second payment or delivery.
- **Server is the source of truth.** The app never computes balances, stock or
  invoices; it shows what the API returns and only patches its saved copy to
  show a queued change until the server confirms it.
- **Role-aware.** The bottom bar and actions come from the `abilities` the API
  returns for the selected farm (`backend/config/farmos.php`).
- **Bangla first.** Bangla is the default (with Bangla digits and ৳ amounts);
  English is one tap away. Strings are shared with the web app.

## Layout

```
lib/
  main.dart, app.dart          start-up, auth gate (login → farm picker → home)
  core/
    config.dart                API base URL (--dart-define=API_BASE_URL=…)
    api/api_client.dart        dio client: auth, X-Farm-Id, Idempotency-Key, error mapping
    offline/outbox.dart        queued writes, ordered replay, rejected-write reporting
    offline/query_cache.dart   saved GET responses per user + farm
    storage/                   Hive (cache, outbox, prefs) and secure storage (token)
    auth/session.dart          /auth/me shapes, ability check
    i18n/                      translations + number/date/money formatting
    providers.dart             Riverpod wiring, AuthController, language
    theme.dart                 brand colours and typography
  features/<feature>/          repository (API + cache + outbox) and screens
  shared/                      common widgets, inputs, call/WhatsApp helpers
assets/i18n/{en,bn}.json       copies of frontend/src/locales (keep in sync)
assets/i18n/mobile.{en,bn}.json  strings only the app uses
test/                          unit tests (client, outbox, cache) and widget tests
```

State is Riverpod. Each screen watches a `StreamProvider` that yields the saved
copy and then the server's answer; repositories are the only code that talks to
the API.

## Set up a Windows PC

This was set up on the project PC under `D:\dev` (C: is nearly full):

| Tool | Where | Notes |
| --- | --- | --- |
| Flutter SDK 3.47 (stable) | `D:\dev\flutter` | from storage.googleapis.com/flutter_infra_release |
| Temurin JDK 21 | `D:\dev\jdk21` | Android Gradle builds |
| Android SDK | `D:\dev\android` | command-line tools, platform-tools, platform 36, build-tools 35 + 36, NDK 28.2, emulator, `android-36` x86_64 image |
| Emulator (AVD) | `D:\dev\avd\aura_pixel` | Pixel 6, Android 16 (Google APIs); runs on Windows Hypervisor Platform |

User environment variables (already set on this PC; set them the same way on another one):

```powershell
[Environment]::SetEnvironmentVariable('JAVA_HOME', 'D:\dev\jdk21', 'User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME', 'D:\dev\android', 'User')
[Environment]::SetEnvironmentVariable('ANDROID_AVD_HOME', 'D:\dev\avd', 'User')
$p = [Environment]::GetEnvironmentVariable('Path', 'User')
[Environment]::SetEnvironmentVariable('Path', "$p;D:\dev\flutter\bin;D:\dev\android\platform-tools;D:\dev\android\emulator;D:\dev\jdk21\bin", 'User')
```

Open a new terminal afterwards, then check with `flutter doctor`.

Installing SDK packages: the current command-line tools name packages with
slashes, and Gradle's automatic download of a missing NDK fails with
"Package ndk not found". Install what a build asks for yourself, e.g.

```bash
sdkmanager ndk/28.2.13676358 build-tools/36.0.0 platforms/android-36
```

To set up from scratch instead: install Flutter (https://docs.flutter.dev/get-started/install/windows/mobile),
Android Studio (it bundles a JDK and the SDK manager) or the command-line tools,
then `flutter doctor --android-licenses`.

## Run

```bash
cd mobile
flutter pub get
flutter emulators --launch aura_pixel     # or plug in an Android phone with USB debugging on
flutter run                               # talks to https://auradairy.com/api
```

Against a local backend (`php artisan serve` in `backend/`): the Android emulator
reaches the PC as `10.0.2.2`.

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8000/api
```

Plain `http://` is only allowed in debug and profile builds (see
`android/app/src/{debug,profile}/AndroidManifest.xml`); release builds use HTTPS only.

On a slow PC the emulator struggles with debug (JIT) builds; a profile build is
compiled ahead of time and runs smoothly. Seeded local logins are in
`backend/database/seeders` (owner@farmos.test …).

```bash
flutter build apk --profile --target-platform android-x64 --dart-define=API_BASE_URL=http://10.0.2.2:8000/api
adb install -r build/app/outputs/flutter-apk/app-profile.apk
```

## Test

```bash
flutter analyze
flutter test
```

- `test/core/api_client_test.dart` — headers, idempotency keys, error mapping, 401 sign-out.
- `test/core/outbox_test.dart` — queueing offline, replay with the same key and farm,
  ordering, rejected writes, 409 retry, per-account queues.
- `test/core/query_cache_test.dart` — saved-copy-then-fresh, offline fallback, scoping; formatting.
- `test/widget/login_test.dart` — sign-in, secure token storage, role-aware navigation.
- `test/widget/milk_sheet_test.dart` — entry, save payload, offline queue and replay.
- `test/widget/modules_test.dart` — stock list, feed use (online and queued), expense form rules, P&L with ledger drill-down, role-filtered More menu.

## Build a release for Android

1. Create an upload key once and keep it safe (losing it means you cannot update the app in Play):

   ```bash
   keytool -genkey -v -keystore D:\dev\keys\aura-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
   ```

2. Create `mobile/android/key.properties` (git-ignored):

   ```properties
   storePassword=…
   keyPassword=…
   keyAlias=upload
   storeFile=D:/dev/keys/aura-upload.jks
   ```

3. Build:

   ```bash
   flutter build appbundle --release      # Play Store: build/app/outputs/bundle/release/app-release.aab
   flutter build apk --release --split-per-abi   # direct install / sharing
   ```

Without `key.properties` the release build is signed with the debug key, which
is fine for testing on your own phones but cannot be uploaded to Play.

Bump `version:` in `pubspec.yaml` (`1.0.1+2` = version name + build number) for every upload.

## iOS

iOS builds need macOS with Xcode; they cannot be produced on this Windows PC
and have not been built or run yet. The `ios/` project is generated and
configured (bundle id `com.auradairy.app`, display name "Aura Dairy", icons),
so either of these works once there is an Apple Developer account (USD 99/year):

**Codemagic (no Mac needed).** Connect the repository at codemagic.io, pick the
`mobile/` folder as the Flutter project, add the App Store Connect API key in
*Teams → Integrations*, enable automatic iOS code signing, and use
`flutter build ipa --release`. Codemagic can upload straight to TestFlight.

**GitHub Actions macOS runner.** Once the repo is on GitHub, a workflow on
`macos-latest` can run `flutter build ipa` with the signing certificate and
provisioning profile stored as encrypted secrets (see
https://docs.flutter.dev/deployment/cd). The free tier counts macOS minutes ×10.

**A Mac.** `cd mobile && flutter build ios --release`, then archive and upload
from Xcode (`open ios/Runner.xcworkspace`).

## Notes

- The API base URL defaults to `https://auradairy.com/api`.
- Queued writes are tied to the account that made them; signing out drops them
  (the app warns first). The server keeps idempotency keys for 24 hours, so a
  phone that stays offline longer than that should sync before retrying.
- Writes the server rejects during replay (for example a validation error) are
  removed from the queue and listed under *More → Sync* so nothing fails silently.
- When `frontend/src/locales/*.json` change, copy them to `assets/i18n/`.
