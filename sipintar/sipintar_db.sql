-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Sep 03, 2026 at 09:39 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `sipintar_db`
--

-- --------------------------------------------------------

--
-- Table structure for table `barang`
--

CREATE TABLE `barang` (
  `id` int(11) NOT NULL,
  `nama_barang` varchar(150) NOT NULL,
  `jenis_barang` varchar(100) NOT NULL,
  `stok` int(11) NOT NULL DEFAULT 0,
  `satuan` varchar(50) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `barang`
--

INSERT INTO `barang` (`id`, `nama_barang`, `jenis_barang`, `stok`, `satuan`, `created_at`) VALUES
(1, 'Absen', 'ATK', 143, 'pcs', '2026-09-03 05:17:44'),
(2, 'Spidol', 'ATK', 147, 'pcs', '2026-09-03 07:03:17'),
(3, 'Jurnal Kelas', 'ATK', 249, 'pcs', '2026-09-03 07:03:31'),
(4, 'Pena', 'ATK', 299, 'pcs', '2026-09-03 07:04:16'),
(5, 'Sapu', 'Alat Kebersihan', 29, 'pcs', '2026-09-03 07:04:50');

-- --------------------------------------------------------

--
-- Table structure for table `detail_transaksi`
--

CREATE TABLE `detail_transaksi` (
  `id` int(11) NOT NULL,
  `kode_transaksi` varchar(50) NOT NULL,
  `nama_barang` varchar(150) NOT NULL,
  `jumlah` int(11) NOT NULL,
  `satuan` varchar(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `transaksi`
--

CREATE TABLE `transaksi` (
  `id` int(11) NOT NULL,
  `kode_transaksi` varchar(50) NOT NULL,
  `tanggal_pengambilan` date NOT NULL,
  `nama_pengambil` varchar(100) NOT NULL,
  `jabatan_unit` varchar(100) NOT NULL,
  `keterangan` text DEFAULT NULL,
  `waktu_input` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `transaksi`
--

INSERT INTO `transaksi` (`id`, `kode_transaksi`, `tanggal_pengambilan`, `nama_pengambil`, `jabatan_unit`, `keterangan`, `waktu_input`) VALUES
(19, 'BRG-20260903-319', '2026-09-03', 'Nadidah Ayu Syafitri', 'Guru Informatika', 'Mengajar', '2026-09-03 14:12:03'),
(20, 'BRG-20260903-651', '2026-09-03', 'Imam Syarifudin', 'Pegawai', 'Di lab Komputer', '2026-09-03 14:12:32'),
(21, 'BRG-20260903-117', '2026-09-03', 'Muthia Khansa Pratiwi', 'Guru Informatika', 'Mengajar', '2026-09-03 14:13:07'),
(22, 'BRG-20260903-630', '2026-09-03', 'Arni Apriani', 'Guru Sejarah', 'Mengajar ', '2026-09-03 14:13:34'),
(23, 'BRG-20260903-584', '2026-09-03', 'Arif Rahmad', 'TU', 'LAB', '2026-09-03 14:39:20');

-- --------------------------------------------------------

--
-- Table structure for table `transaksi_detail`
--

CREATE TABLE `transaksi_detail` (
  `id` int(11) NOT NULL,
  `kode_transaksi` varchar(50) NOT NULL,
  `nama_barang` varchar(150) NOT NULL,
  `jumlah` int(11) NOT NULL,
  `satuan` varchar(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `transaksi_detail`
--

INSERT INTO `transaksi_detail` (`id`, `kode_transaksi`, `nama_barang`, `jumlah`, `satuan`) VALUES
(20, 'BRG-20260903-319', 'Pena', 1, 'pcs'),
(21, 'BRG-20260903-319', 'Absen', 1, 'pcs'),
(22, 'BRG-20260903-319', 'Spidol', 1, 'pcs'),
(23, 'BRG-20260903-651', 'Sapu', 1, 'pcs'),
(24, 'BRG-20260903-117', 'Absen', 1, 'pcs'),
(25, 'BRG-20260903-117', 'Spidol', 1, 'pcs'),
(26, 'BRG-20260903-630', 'Absen', 1, 'pcs'),
(27, 'BRG-20260903-630', 'Jurnal Kelas', 1, 'pcs'),
(28, 'BRG-20260903-584', 'Spidol', 1, 'pcs');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `nama_lengkap` varchar(100) NOT NULL,
  `role` enum('admin','pegawai','pemantau') NOT NULL DEFAULT 'pegawai'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `username`, `password`, `nama_lengkap`, `role`) VALUES
(1, 'petugas2', 'petugas2', 'Administrator TU', 'pegawai'),
(2, 'petugas1', 'petugas123', 'Petugas Inventaris', 'pegawai'),
(5, 'admin', 'admin', 'Pegawai MAN 1', 'admin'),
(7, 'p3', 'p3', 'p', 'pegawai'),
(8, 'petugas3', 'petugas3', 'aaaa', 'pegawai'),
(9, 'pemantau1', 'pemantau123', 'Pemantau Stok MAN 1', 'pemantau');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `barang`
--
ALTER TABLE `barang`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `detail_transaksi`
--
ALTER TABLE `detail_transaksi`
  ADD PRIMARY KEY (`id`),
  ADD KEY `kode_transaksi` (`kode_transaksi`);

--
-- Indexes for table `transaksi`
--
ALTER TABLE `transaksi`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `kode_transaksi` (`kode_transaksi`);

--
-- Indexes for table `transaksi_detail`
--
ALTER TABLE `transaksi_detail`
  ADD PRIMARY KEY (`id`),
  ADD KEY `kode_transaksi` (`kode_transaksi`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `barang`
--
ALTER TABLE `barang`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `detail_transaksi`
--
ALTER TABLE `detail_transaksi`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `transaksi`
--
ALTER TABLE `transaksi`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=24;

--
-- AUTO_INCREMENT for table `transaksi_detail`
--
ALTER TABLE `transaksi_detail`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=29;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `detail_transaksi`
--
ALTER TABLE `detail_transaksi`
  ADD CONSTRAINT `detail_transaksi_ibfk_1` FOREIGN KEY (`kode_transaksi`) REFERENCES `transaksi` (`kode_transaksi`) ON DELETE CASCADE;

--
-- Constraints for table `transaksi_detail`
--
ALTER TABLE `transaksi_detail`
  ADD CONSTRAINT `transaksi_detail_ibfk_1` FOREIGN KEY (`kode_transaksi`) REFERENCES `transaksi` (`kode_transaksi`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
