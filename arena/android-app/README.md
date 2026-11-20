# Arena Secure Android (prototype)

This is a new Android WebView shell for the Arena web app. It does not contain the CBT Android project or a separate authentication/API implementation. Arena remains the source of truth for login, exam state, answers, and scoring.

The app enables Android `FLAG_SECURE`, hides non-system overlays where Android supports it, blocks obscured touches, disables file/content access and mixed content, disables third-party cookies, restricts top-level navigation to the configured Arena HTTPS origin, and covers the app in multi-window mode.

Behavior hardening (signals diteruskan ke web app):

- Setiap kali host berhenti (`onPause`, `onUserLeaveHint`) atau kehilangan fokus jendela — misalnya overlay Gemini/asisten sistem muncul di atas layar ujian — aplikasi menyuntikkan event `arena-host-hidden` ke halaman. Halaman ujian mencatatnya sebagai pelanggaran `APP_OVERLAY` yang dihitung menuju threshold terminasi di server. Sinyal satu episode yang sama (TAB_HIDDEN, WINDOW_BLUR, APP_OVERLAY) digabungkan client ke satu `event_key` sehingga satu episode tombol home dihitung hanya satu pelanggaran.
- Layar tidak mati sendiri: selama attempt ujian aktif, halaman memanggil `ArenaApp.setKeepScreenOn(true)` (bridge kecil satu tombol) sehingga `FLAG_KEEP_SCREEN_ON` menahan layar dan screen timeout tidak memicu pelanggaran palsu. Setelah ujian selesai/ditinggalkan, halaman melepasnya (`false`). Pada browser biasa, halaman memakai Screen Wake Lock API dengan re-request otomatis saat tab kembali terlihat.
- **Mode ujian (kiosk ringan):** selama attempt aktif halaman memanggil `ArenaApp.setExamMode(true)`. Shell menyembunyikan status/navigation bar (immersive sticky), memblokir tombol Back, dan memulai **screen pinning** (`startLockTask()`), sehingga tombol Home/Recents tidak bisa meninggalkan aplikasi. Mode dilepas (`setExamMode(false)`) ketika siswa membuka bantuan, ada error simpan, waktu habis, atau selesai. Sebagai lapisan pengaman, shell juga **memeriksa sendiri** setiap 1,5 detik: kalau elemen `.student-exam` tampil (atau atribut `data-arena-exam="on"` dipasang halaman), mode ujian dinyalakan walau bundle web yang termuat belum memanggil bridge. Bila dialog pin ditolak, shell menampilkan pesan dan mencoba memasang pin lagi (maksimal 3 kali). Di perangkat tanpa device owner, Android menampilkan dialog konfirmasi pin dan gesture unpin (tahan Back + Recents) tetap tersedia; untuk kiosk penuh tanpa gesture unpin, daftarkan paket lewat device owner/MDM.
- `FLAG_SECURE` membuat konten ujian tidak dapat ditangkap asisten (Circle to Search/Gemini menampilkan layar tersensor), dan screenshot recents dinonaktifkan pada API 34+ (`setRecentsScreenshotEnabled(false)`). Overlay asisten sendiri tidak bisa diblokir penuh oleh aplikasi biasa; setiap overlay tetap tercatat sebagai pelanggaran dan tampil di portal pengawas.

Catatan pengawas: layar menyala penuh selama ujian menguras baterai lebih cepat — sarankan peserta membawa pengisi daya atau power bank saat sesi lebih dari 45 menit.

Build against a deployment origin supplied locally; no school domain is assumed:

```sh
./gradlew assembleDebug -PARENA_BASE_URL=https://arena.example.school
```

APK hasil build ada di `app/build/outputs/apk/debug/`. Repo ini sudah menyertakan Gradle Wrapper 8.10.2, jadi tidak perlu memasang Gradle manual.

### Build tanpa memasang JDK/Android SDK (Docker)

```sh
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp/gradle \
  -v "$PWD":/workspace -w /workspace \
  ghcr.io/cirruslabs/android-sdk:35 \
  ./gradlew assembleDebug -PARENA_BASE_URL=https://arena.example.school --no-daemon
```

Image tersebut sudah berisi JDK 21, Android SDK 35, dan build-tools 35.0.0.

### Release signing

APK release harus ditandatangani. Jangan pernah commit keystore. Buat sekali, lalu **backup** file `.jks` beserta password-nya — update aplikasi hanya bisa menimpa instalasi lama jika memakai kunci yang sama.

```sh
keytool -genkeypair -v -keystore keystore/arena-release.jks -alias arena \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Arena CBT, O=MAN 1 Palembang, C=ID"
```

Build release dengan signing yang di-inject (tanpa menaruh password di `build.gradle`):

```sh
./gradlew assembleRelease -PARENA_BASE_URL=https://arena.example.school \
  -Pandroid.injected.signing.store.file="$PWD/keystore/arena-release.jks" \
  -Pandroid.injected.signing.store.password="$STORE_PASSWORD" \
  -Pandroid.injected.signing.key.alias=arena \
  -Pandroid.injected.signing.key.password="$KEY_PASSWORD"
```

APK release ada di `app/build/outputs/apk/release/`. Verifikasi dengan `apksigner verify --print-certs app-release.apk`.

Requires JDK 17+, Android SDK 35, build-tools 35.0.0, dan Android Gradle Plugin 8.7.0 (sudah diatur di project). APK release sudah berhasil dibuild dan diverifikasi signature-nya di environment ini; tetap uji di perangkat siswa yang representatif, termasuk screenshot/recording shortcuts, vendor overlays, multi-window, session restore, external identity-provider redirect behavior, connectivity loss, dan answer autosave sebelum dipakai sekolah. `FLAG_SECURE` cannot stop external cameras, and opening Arena in a normal browser does not receive native protection.
