# CBT Aman Android (prototipe)

Aplikasi ini membuka `https://cbt.rdmman1plg.id/` di Android WebView. Login, soal, jawaban, dan nilai tetap ditangani server CBT yang sama; tidak ada API atau akun Android baru.

Perlindungan yang diterapkan:

- `FLAG_SECURE` membuat isi jendela aplikasi tidak muncul dalam screenshot/rekaman layar Android. Ini **mencegah** tangkapan layar, bukan mencatat percobaan sebagai pelanggaran. Pada Android 14, callback screenshot native juga tidak dipanggil untuk jendela yang memakai `FLAG_SECURE`.
- Android 12+ menyembunyikan overlay aplikasi non-sistem melalui `HIDE_OVERLAY_WINDOWS`. Ini tidak mencakup semua elemen sistem atau semua perilaku vendor.
- Mode multi-window yang dilaporkan Android menutup tampilan CBT dengan pesan. Atribut `resizeableActivity=false` juga meminta Android tidak membuka aplikasi dalam split-screen, tetapi perilakunya dapat berbeda antarperangkat.
- WebView hanya mengizinkan navigasi utama HTTPS ke `cbt.rdmman1plg.id`; tidak ada JavaScript bridge, akses file lokal, atau HTTP biasa.

## Bangun dan uji

Lingkungan kerja ini tidak memiliki Android SDK/JDK, sehingga APK belum dapat dibuat di sini. Gunakan Android Studio dengan JDK 17, Android SDK 35, dan Gradle 8.9 (Android Gradle Plugin 8.7.0). Proyek sumber berada di folder ini dan belum menyertakan Gradle wrapper; gunakan instalasi Gradle lokal atau buat wrapper dengan `gradle wrapper --gradle-version 8.9` sebelum build CLI.

1. Buka folder `android-app` sebagai proyek di Android Studio, lalu sinkronkan Gradle.
2. Jalankan konfigurasi `app` pada ponsel Android atau buat APK debug dengan `gradle assembleDebug`.
3. Login ke CBT dari aplikasi. Sesi browser Chrome tidak otomatis berpindah ke WebView, jadi login ulang diperlukan.
4. Selama ujian, coba screenshot tombol fisik, gestur vendor, perekam layar, split-screen, dan overlay pihak ketiga pada beberapa model ponsel. Periksa apakah gambar CBT terblokir dan apakah soal tetap dapat dijawab/disimpan.
5. Uji koneksi putus, rotasi, aplikasi masuk latar, serta login ulang. Jangan gunakan untuk ujian resmi sebelum pengujian perangkat nyata selesai.

APK debug bukan rilis sekolah. Untuk distribusi resmi perlu penandatanganan APK, pengujian pada perangkat siswa, dan kebijakan perangkat. Siswa yang tetap membuka situs di browser biasa tidak mendapat perlindungan `FLAG_SECURE`; server saat ini belum mewajibkan aplikasi Android ini. iPhone juga belum tercakup.
