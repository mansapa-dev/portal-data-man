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
      <span>MAN 1</span>
      <strong>CBT Guru</strong>
    </div>
    <nav>
      <button class="nav-item active" data-section="exams"><i class="fa-solid fa-file-lines" style="margin-right:8px; width:16px;"></i> Ujian Diampu</button>
      <button class="nav-item" data-section="results"><i class="fa-solid fa-square-poll-vertical" style="margin-right:8px; width:16px;"></i> Hasil Siswa</button>
      <button class="nav-item" data-section="violations"><i class="fa-solid fa-shield-cat" style="margin-right:8px; width:16px;"></i> Pelanggaran</button>
      <button class="nav-item" data-section="account"><i class="fa-solid fa-key" style="margin-right:8px; width:16px;"></i> Ubah Password</button>
    </nav>
    <button id="logout" class="logout"><i class="fa-solid fa-arrow-right-from-bracket" style="margin-right:6px;"></i> Keluar</button>
  </aside>

  <main class="main">
    <header class="topbar">
      <button id="menu" class="menu">☰</button>
      <div style="margin-left:0; text-align:left;">
        <span style="font-size:13px; font-weight:700; color:var(--green-dark);">CBT MAN 1 Palembang</span>
      </div>
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="text-align:right;">
          <small>Portal Guru</small>
          <strong id="teacherName"><?=htmlspecialchars($nip, ENT_QUOTES, 'UTF-8')?></strong>
        </div>
        <button id="topbarLogoutGuru" type="button" class="btn btn-danger" style="padding:6px 12px; font-size:12px;" title="Keluar dari Portal Guru">
          <i class="fa-solid fa-arrow-right-from-bracket"></i> Keluar
        </button>
      </div>
    </header>

    <section class="welcome">
      <div>
        <span class="eyebrow">DASHBOARD GURU CBT</span>
        <h1>Ujian & Mapel yang Diampu</h1>
        <p>Pantau data penugasan soal, rekapitulasi nilai, dan log pelanggaran siswa.</p>
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
