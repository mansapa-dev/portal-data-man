# Import Data Guru

Import guru menggunakan field dan aturan yang sama dengan form **Tambah Guru** di Portal Data.

## Kolom template

Urutan header wajib:

1. Nama Lengkap
2. NIP
3. NUPTK
4. Nomor Pegawai
5. Email
6. Telepon
7. Jenis Kelamin
8. Status
9. Alamat

Minimal salah satu dari NIP, NUPTK, Nomor Pegawai, atau Email wajib tersedia. Nilai NIP/NUPTK diperlakukan sebagai teks agar angka panjang tidak berubah oleh Excel.

Nilai jenis kelamin yang diterima: `L`, `LAKI_LAKI`, `MALE`, `P`, `PEREMPUAN`, atau `FEMALE`. Nilai status mendukung `AKTIF`/`ACTIVE`, `TIDAK AKTIF`/`INACTIVE`, `PENSIUN`/`RETIRED`, dan `PINDAH`/`TRANSFERRED`.

## Alur penggunaan

1. Buka menu **Import Data**.
2. Unduh **Template guru**.
3. Isi workbook tanpa mengganti header.
4. Pilih **Import guru** dan unggah file `.xlsx`.
5. Periksa hasil validasi per baris.
6. Commit hanya jika ringkasan sudah sesuai.
7. Unduh error file jika terdapat baris gagal.

Saat commit, Portal Data mencari guru berdasarkan seluruh identifier yang terisi. Jika identifier pada satu baris ternyata dimiliki beberapa guru berbeda, baris ditolak dan guru lain tetap diproses. Import tidak membuat akun login guru secara otomatis; akun tetap dibuat melalui panel akun pada detail guru.
