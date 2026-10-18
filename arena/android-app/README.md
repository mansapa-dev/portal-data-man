# Arena Secure Android (prototype)

This is a new Android WebView shell for the Arena web app. It does not contain the CBT Android project or a separate authentication/API implementation. Arena remains the source of truth for login, exam state, answers, and scoring.

The app enables Android `FLAG_SECURE`, hides non-system overlays where Android supports it, blocks obscured touches, disables file/content access and mixed content, disables third-party cookies, restricts top-level navigation to the configured Arena HTTPS origin, and covers the app in multi-window mode.

Build against a deployment origin supplied locally; no school domain is assumed:

```sh
gradle assembleDebug -PARENA_BASE_URL=https://arena.example.school
```

Requires JDK 17, Android SDK 35, and Gradle 8.9 or Android Studio with Android Gradle Plugin 8.7.0. This environment has not built an APK. Test on representative student devices, including screenshot/recording shortcuts, vendor overlays, multi-window, session restore, external identity-provider redirect behavior, connectivity loss, and answer autosave before school use. `FLAG_SECURE` cannot stop external cameras, and opening Arena in a normal browser does not receive native protection. Production signing and distribution are separate release steps.
