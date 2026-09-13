-- Fresh installations only. No accounts or sample data.
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
ALTER TABLE borrowings ADD PRIMARY KEY (id), ADD INDEX idx_borrowings_date (date,time), ADD INDEX idx_borrowings_returned (returned,date);
