# Arena Secure Android (prototype)

This is a new Android WebView shell for the Arena web app. It does not contain the CBT Android project or a separate authentication/API implementation. Arena remains the source of truth for login, exam state, answers, and scoring.

The app enables Android `FLAG_SECURE`, hides non-system overlays where Android supports it, blocks obscured touches, disables file/content access and mixed content, disables third-party cookies, restricts top-level navigation to the configured Arena HTTPS origin, and covers the app in multi-window mode.

Behavior hardening (signals diteruskan ke web app):

- Setiap kali host berhenti (`onPause`, `onUserLeaveHint`) atau kehilangan fokus jendela — misalnya overlay Gemini/asisten sistem muncul di atas layar ujian — aplikasi menyuntikkan event `arena-host-hidden` ke halaman. Halaman ujian mencatatnya sebagai pelanggaran `APP_OVERLAY` yang dihitung menuju threshold terminasi di server. Sinyal satu episode yang sama (TAB_HIDDEN, WINDOW_BLUR, APP_OVERLAY) digabungkan client ke satu `event_key` sehingga satu episode tombol home dihitung hanya satu pelanggaran.
- Layar tidak mati sendiri: selama attempt ujian aktif, halaman memanggil `ArenaApp.setKeepScreenOn(true)` (bridge kecil satu tombol) sehingga `FLAG_KEEP_SCREEN_ON` menahan layar dan screen timeout tidak memicu pelanggaran palsu. Setelah ujian selesai/ditinggalkan, halaman melepasnya (`false`). Pada browser biasa, halataman memakai Screen Wake Lock API dengan re-request otomatis saat tab kembali terlihat.
- `FLAG_SECURE` membuat konten ujian tidak dapat ditangkap asisten (Circle to Search/Gemini menampilkan layar tersensor), dan screenshot recents dinonaktifkan pada API 34+ (`setRecentsScreenshotEnabled(false)`). Overlay asisten sendiri tidak bisa diblokir penuh oleh aplikasi biasa; blokir penuh tombol home/asisten butuh mode kiosk (device owner / Lock Task). Sampai itu, setiap overlay tetap tercatat sebagai pelanggaran dan tampil di portal pengawas.

Catatan pengawas: layar menyala penuh selama ujian menguras baterai lebih cepat — sarankan peserta membawa pengisi daya atau power bank saat sesi lebih dari 45 menit.

Build against a deployment origin supplied locally; no school domain is assumed:

```sh
gradle assembleDebug -PARENA_BASE_URL=https://arena.example.school
```

Requires JDK 17, Android SDK 35, and Gradle 8.9 or Android Studio with Android Gradle Plugin 8.7.0. This environment has not built an APK. Test on representative student devices, including screenshot/recording shortcuts, vendor overlays, multi-window, session restore, external identity-provider redirect behavior, connectivity loss, and answer autosave before school use. `FLAG_SECURE` cannot stop external cameras, and opening Arena in a normal browser does not receive native protection. Production signing and distribution are separate release steps.
