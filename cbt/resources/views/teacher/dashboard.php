<?php
declare(strict_types=1);
ob_start();
$teacher=$_SESSION['auth'];
?>
<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard Guru - CBT MAN 1 Palembang</title><link rel="stylesheet" href="../assets/css/teacher.css"></head>
<body class="dashboard-page"><aside class="sidebar"><div class="brand"><span>MAN 1</span><strong>CBT Guru</strong></div><nav><button class="nav-item active" data-section="exams">Ujian Diampu</button><button class="nav-item" data-section="results">Hasil Siswa</button><button class="nav-item" data-section="violations">Pelanggaran</button><button class="nav-item" data-section="account">Ubah Password</button></nav><button id="logout" class="logout">Keluar</button></aside><main class="main"><header class="topbar"><button id="menu" class="menu">☰</button><div><small>Portal Guru</small><strong id="teacherName"><?=htmlspecialchars((string)($teacher['nip']??''),ENT_QUOTES,'UTF-8')?></strong></div></header><section class="welcome"><div><span class="eyebrow">DASHBOARD GURU</span><h1>Ujian & Mapel yang Diampu</h1><p>Data penugasan, nilai, dan pelanggaran peserta.</p></div><div class="nip-card"><small>NIP</small><strong><?=htmlspecialchars((string)($teacher['nip']??''),ENT_QUOTES,'UTF-8')?></strong></div></section><div id="notice" class="message" aria-live="polite"></div><section id="content" class="content-grid"></section></main><script src="../assets/js/teacher/dashboard.js"></script></body></html>
<?php return ob_get_clean();
