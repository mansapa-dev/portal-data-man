-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Waktu pembuatan: 02 Sep 2026 pada 15.40
-- Versi server: 10.4.28-MariaDB
-- Versi PHP: 8.0.28

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `db_sarpras`
--

-- --------------------------------------------------------

--
-- Struktur dari tabel `borrowings`
--

CREATE TABLE `borrowings` (
  `id` varchar(50) NOT NULL,
  `date` date NOT NULL,
  `time` time NOT NULL,
  `name` varchar(100) NOT NULL,
  `type` varchar(20) NOT NULL,
  `id_num` varchar(50) DEFAULT '-',
  `item` varchar(150) NOT NULL,
  `qty` int(11) DEFAULT 1,
  `purpose` text NOT NULL,
  `expected_return` date NOT NULL,
  `actual_return` varchar(30) DEFAULT '-',
  `returned` tinyint(1) DEFAULT 0,
  `condition` varchar(100) DEFAULT 'Baik',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data untuk tabel `borrowings`
--

INSERT INTO `borrowings` (`id`, `date`, `time`, `name`, `type`, `id_num`, `item`, `qty`, `purpose`, `expected_return`, `actual_return`, `returned`, `condition`, `created_at`) VALUES
('MAN1-20260902-226', '2026-09-02', '15:13:00', 'Muthia ', 'Guru', '-', 'Kabel Panjang', 1, 'Mengajar', '2026-09-02', '2026-09-02 15:13', 1, 'Baik', '2026-09-02 13:13:31'),
('MAN1-20260902-768', '2026-08-30', '15:21:00', 'nadidah', 'Guru', 'a', 'Proyektor + HDMI', 1, 'a', '2026-09-02', '-', 0, 'Baik', '2026-09-02 13:21:19');

-- --------------------------------------------------------

--
-- Struktur dari tabel `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `nama_lengkap` varchar(100) NOT NULL,
  `role` enum('admin','petugas') DEFAULT 'petugas',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data untuk tabel `users`
--

INSERT INTO `users` (`id`, `username`, `password`, `nama_lengkap`, `role`, `created_at`) VALUES
(2, 'admin', '$2y$10$8VDt9vDFAIsPxKZfdaoyT.9piuv/Iu7uNrxhQiiS3iHio1/xK5hJ2', 'Administrator Sarpras', 'petugas', '2026-09-02 13:10:42'),
(3, 'sarpras', '$2y$10$n0zZSBU57vt5qeKX79MBxeznfDZEfXgrzXJRPZRB2iZiVm2cqHEQO', 'Imam', 'petugas', '2026-09-02 13:12:50');

--
-- Indexes for dumped tables
--

--
-- Indeks untuk tabel `borrowings`
--
ALTER TABLE `borrowings`
  ADD PRIMARY KEY (`id`);

--
-- Indeks untuk tabel `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`);

--
-- AUTO_INCREMENT untuk tabel yang dibuang
--

--
-- AUTO_INCREMENT untuk tabel `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
