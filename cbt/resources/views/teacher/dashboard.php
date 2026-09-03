<?php
declare(strict_types=1);
ob_start();
$teacher=$_SESSION['auth'] ?? [];
$nip = (string)($teacher['nip'] ?? $teacher['username'] ?? 'Guru');
?>
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Dashboard Guru - CBT MAN 1 Palembang</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="stylesheet" href="../assets/css/teacher.css">
</head>
<body class="dashboard-page">
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark"><img src="../assets/img/logo-man1-palembang.png" alt="Lambang MAN 1 Palembang"></span>
      <div><strong>MANSAPA ARENA</strong><small>Area Evaluasi dan Asesmen</small></div>
    </div>
    <nav>
      <span class="nav-label">UTAMA</span>
      <button class="nav-item active" data-section="overview"><i class="fa-solid fa-house"></i> Dashboard</button>
      <span class="nav-label">MONITORING</span>
      <button class="nav-item" data-section="exams"><i class="fa-solid fa-calendar-days"></i> Ujian Diampu</button>
      <button class="nav-item" data-section="results"><i class="fa-solid fa-square-poll-vertical"></i> Hasil Siswa</button>
      <button class="nav-item" data-section="violations"><i class="fa-solid fa-shield-halved"></i> Pelanggaran</button>
      <span class="nav-label">PENGATURAN</span>
      <button class="nav-item" data-section="account"><i class="fa-solid fa-key"></i> Ubah Password</button>
    </nav>
    <button id="logout" class="logout"><i class="fa-solid fa-arrow-right-from-bracket" style="margin-right:6px;"></i> Keluar</button>
  </aside>

  <main class="main">
    <header class="topbar">
      <button id="menu" class="menu">☰</button>
      <h1 id="teacherPageTitle">Dashboard</h1>
      <div style="display:flex; align-items:center; gap:14px;">
        <button class="notification-button" type="button" aria-label="Notifikasi"><i class="fa-regular fa-bell"></i></button>
        <div style="text-align:right;">
          <small>Portal Guru</small>
          <strong id="teacherName"><?=htmlspecialchars($nip, ENT_QUOTES, 'UTF-8')?></strong>
        </div>
      </div>
    </header>

    <section class="welcome">
      <div>
        <span class="eyebrow">DASHBOARD GURU CBT</span>
        <h1>Selamat bertugas, Guru</h1>
        <p>Pantau ujian yang diampu, hasil siswa, serta pelanggaran ujian dari satu tempat.</p>
      </div>
      <div class="nip-card">
        <small>NIP / IDENTITAS</small>
        <strong><?=htmlspecialchars($nip, ENT_QUOTES, 'UTF-8')?></strong>
      </div>
    </section>

    <div id="notice" class="message" aria-live="polite"></div>
    <section id="content" class="content-grid"></section>
  </main>

  <script src="../assets/js/teacher/dashboard.js"></script>
</body>
</html>
<?php return ob_get_clean();
