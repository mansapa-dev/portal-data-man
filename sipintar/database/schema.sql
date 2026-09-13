-- Fresh installations only. Existing installations use console.php migrate-business.
CREATE TABLE barang (
 id INT AUTO_INCREMENT PRIMARY KEY, nama_barang VARCHAR(150) NOT NULL,
 jenis_barang VARCHAR(100) NOT NULL, stok INT NOT NULL DEFAULT 0,
 satuan VARCHAR(50) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_barang_nama (nama_barang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE transaksi (
 id INT AUTO_INCREMENT PRIMARY KEY, kode_transaksi VARCHAR(50) NOT NULL UNIQUE,
 tipe ENUM('MASUK','KELUAR') NOT NULL DEFAULT 'KELUAR', tanggal_pengambilan DATE NOT NULL,
 nama_pengambil VARCHAR(100) NOT NULL, jabatan_unit VARCHAR(100) NOT NULL,
 keterangan TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_transaksi_date (tanggal_pengambilan,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE transaksi_detail (
 id INT AUTO_INCREMENT PRIMARY KEY, kode_transaksi VARCHAR(50) NOT NULL,
 nama_barang VARCHAR(150) NOT NULL, jumlah INT NOT NULL, satuan VARCHAR(50) NOT NULL,
 FOREIGN KEY (kode_transaksi) REFERENCES transaksi(kode_transaksi) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
