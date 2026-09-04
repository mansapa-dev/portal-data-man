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
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <link rel="stylesheet" href="../assets/css/teacher.css?v=20260904-2">
</head>
<body class="dashboard-page">
  <div class="teacher-sidebar-backdrop" id="teacherSidebarBackdrop"></div>
  <aside class="sidebar" id="teacherSidebar">
    <div class="brand">
      <span class="brand-mark"><img src="../assets/img/logo-man1-palembang.png" alt="Lambang MAN 1 Palembang"></span>
      <div><strong>MANSAPA ARENA</strong><small>Area Evaluasi dan Asesmen</small></div>
      <button id="sidebarMenu" class="sidebar-menu" type="button" aria-label="Perkecil menu navigasi"><i class="fa-solid fa-bars"></i></button>
    </div>
    <nav>
      <span class="nav-label">UTAMA</span>
      <button class="nav-item active" data-section="overview"><i class="fa-solid fa-house"></i><span>Dashboard</span></button>
      <span class="nav-label">MONITORING</span>
      <button class="nav-item" data-section="exams"><i class="fa-solid fa-calendar-days"></i><span>Ujian Diampu</span></button>
      <button class="nav-item" data-section="results"><i class="fa-solid fa-square-poll-vertical"></i><span>Hasil Siswa</span></button>
      <button class="nav-item" data-section="violations"><i class="fa-solid fa-shield-halved"></i><span>Pelanggaran</span></button>
    </nav>
    <div class="teacher-help-box">
      <h5>Butuh Bantuan?</h5>
      <p>Hubungi tim proktor atau admin jika terdapat kendala ujian.</p>
      <button type="button" id="teacherHelpButton">Bantuan Proktor</button>
    </div>
    <div class="teacher-user-footer"><div class="teacher-avatar" id="teacherAvatar">G</div><div><strong id="teacherSidebarName"><?=htmlspecialchars($nip, ENT_QUOTES, 'UTF-8')?></strong><small>Guru Mata Pelajaran</small></div></div>
  </aside>

  <main class="main">
    <header class="topbar">
      <div class="teacher-topbar-left"><button id="menu" class="menu" aria-label="Buka menu navigasi" aria-expanded="true"><i class="fa-solid fa-bars"></i></button><div class="teacher-topbar-brand"><img src="../assets/img/logo-man1-palembang.png" alt="Lambang MAN 1 Palembang"><div><strong>MANSAPA ARENA</strong><span id="teacherPageTitle">Dashboard</span></div></div></div>
      <div class="teacher-topbar-actions">
        <span class="teacher-online"><span></span>Sistem Online</span>
        <div class="teacher-identity"><small>Portal Guru</small><strong id="teacherName"><?=htmlspecialchars($nip, ENT_QUOTES, 'UTF-8')?></strong></div>
        <button id="topbarLogoutGuru" type="button" class="topbar-logout" title="Keluar dari dashboard guru"><i class="fa-solid fa-arrow-right-from-bracket"></i><span>Keluar</span></button>
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

  <script src="../assets/js/teacher/dashboard.js?v=20260904-2"></script>
</body>
</html>
<?php return ob_get_clean();
