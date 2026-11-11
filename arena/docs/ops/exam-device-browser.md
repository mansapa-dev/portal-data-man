# Browser dan perangkat ujian — konsol bersih, tanpa ekstensi

Dokumen ini untuk petugas/operator yang menyiapkan komputer siswa sebelum ujian.
Tujuannya: konsol browser tidak menampilkan error palsu, dan halaman ujian
tidak disisipi skrip pihak ketiga.

## 1. Error konsol yang normal (bukan gangguan ARENA)

| Pesan di konsol | Sumber | Tindakan |
| --- | --- | --- |
| `Could not establish connection. Receiving end does not exist.` | Ekstensi Chrome/Edge memanggil `chrome.runtime.sendMessage` tanpa penerima | Matikan/nonaktifkan ekstensi; bukan ARENA |
| `ApolloError: Response not successful: Received status code 403` dari berkas `index-<hash>.js` | Skrip pihak ketiga (ekstensi) memakai Apollo Client | Matikan/nonaktifkan ekstensi; bukan ARENA |
| `Failed to load resource: ... execute-api.<aws-region>.amazonaws.com ... 403` | Panggilan API pihak ketiga pada origin yang sama | Matikan/nonaktifkan ekstensi atau skrip sisipan; bukan ARENA |
| `GET /api/student/exams/<id>` → 404 | ARENA tidak menyediakan endpoint ini (hanya daftar `/api/student/exams` dan sub-path-nya) | Permintaan bukan dari ARENA; periksa ekstensi |

Cara memastikan sumbernya:

1. Buka DevTools → tab **Network**, filter `/api/`, dan lihat request mana yang
   benar-benar dari ARENA (respons JSON `{"error": ...}`).
2. Buka DevTools → tab **Sources**, cari berkas skrip yang mentioned di atas.
   Bila berkasnya berada di `chrome-extension://…`, itu ekstensi.
3. Uji tanpa ekstensi: jendela incognito (Ctrl+Shift+N) memuat ekstensi secara
   default. Gunakan profil bersih atau nonaktifkan ekstensi via kebijakan.

## 2. Noise 401 yang sudah diperbaiki

Dulu halaman utama selalu memanggil dua endpoint sesi
(`/api/auth/student/session` dan `/api/auth/staff/session`) sehingga browser
menampilkan dua baris merah **401 Unauthorized** bagi setiap pengunjung
anonim. Sekarang permintaan itu hanya dilakukan bila penanda portal
(`arena_active_portal` di localStorage) menandakan ada sesi, sehingga:

- Pengunjung anonim: 0 permintaan sesi, 0 error konsol.
- Siswa/pengelola yang kembali: 1 permintaan sesi (200), tanpa 401.

Commit: `8a78be28` (`fix(arena): skip session probes for anonymous visitors`).

## 3. Rekomendasi untuk komputer ujian

1. Gunakan profil browser khusus ujian yang **tanpa ekstensi** (kiosk mode atau
   kebijakan grup yang memblokir ekstensi). Ekstensi bisa mengubah halaman,
   membocorkan isi layar, atau menyisipkan permintaan ke server saat ujian.
2. Hapus cache HTML sebelum sesi: `Ctrl+Shift+R`. ARENA memakai nama aset
   ber-hash, jadi aset lama tidak lagi dipakai setelah halaman disegarkan.
3. Nonaktifkan notifikasi/permission yang tidak diperlukan, dan matikan
   auto-update browser saat ujian berjalan.
4. Pastikan jam perangkat sudah benar (ARENA memakai waktu server untuk
   `expires_at`).
5. Catat versi browser di tiap kelas untuk memudahkan troubleshooting.

## 4. Pemeriksaan cepat sebelum ujian

```text
[ ] Incognito/profil bersih: halaman muncul tanpa error konsol merah
[ ] Login siswa: tombol "Masuk Ujian" berfungsi dalam < 10 detik
[ ] Ikon dan rumus tampil (butuh akses ke cdnjs/jsdelivr untuk Font Awesome & MathJax)
[ ] Setelah login: Network tidak menunjukkan 401 pada endpoint sesi
[ ] Refresh halaman: siswa tetap masuk (sesi dipulihkan otomatis)
```

## 5. Kalau jaringan memblokir CDN eksternal

`apps/web/index.html` memuat dua aset pihak ketiga: Font Awesome (cdnjs) dan
MathJax (jsdelivr). Bila jaringan sekolah memblokir keduanya:

- Ikon berubah menjadi kotak kosong (bukan fatal).
- Rumus LaTeX pada soal **tidak** dirender (pakai MathML/Unicode sebagai
  gantinya).

Rencana hardening: memindahkan kedua aset ke `apps/web/public/vendor/` agar
ujian tidak bergantung pada internet. Jika jaringan perlu diperbaiki, jalankan
pemeriksaan di atas dan laporkan gejalanya.
