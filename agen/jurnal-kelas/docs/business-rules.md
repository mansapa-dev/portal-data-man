# Business Rules

- Identitas guru selalu berasal dari session hasil autentikasi.
- Semua ID eksternal/URL menggunakan ULID; numeric primary key hanya internal database.
- Jam pelajaran berada pada 1–11 dan akhir tidak boleh mendahului awal.
- Satu siswa hanya mempunyai satu attendance record pada satu session.
- Barcode NISN hanya sah untuk anggota kelas aktif yang dipilih.
- Attendance final tidak boleh memiliki status `UNMARKED`.
- Journal final membutuhkan minimal satu dokumentasi valid.
- Journal final tidak diedit atau dihapus langsung; perubahan melalui revision beralasan.
- Guru hanya mengelola journal miliknya; ADMIN lintas guru; AUDITOR read-only.
- Nomor absen berasal dari snapshot enrollment Portal Data.
- Export selalu menjalankan ulang query backend berdasarkan filter terotorisasi.
- Semua perhitungan periode menggunakan `Asia/Jakarta`.
