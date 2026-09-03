<?php
declare(strict_types=1);
ob_start();
?>
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Login Guru - CBT MAN 1 Palembang</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="stylesheet" href="assets/css/teacher.css">
</head>
<body class="auth-page">
  <main class="auth-card">
    <section class="auth-visual">
      <div class="school-mark"><i class="fa-solid fa-graduation-cap"></i></div>
      <h1>Portal Guru CBT</h1>
      <p>Monitoring pelaksanaan ujian, rekapitulasi nilai peserta, dan rekam jejak integritas ujian MAN 1 Palembang.</p>
    </section>
    <section class="auth-form">
      <div>
        <span class="eyebrow">CBT MAN 1 PALEMBANG</span>
        <h2>Selamat Datang</h2>
        <p>Gunakan akun guru Portal Data yang terdaftar untuk masuk ke sistem.</p>
      </div>
      <a class="sso-button" href="../auth/sso/start">
        <i class="fa-solid fa-right-to-bracket"></i> Masuk dengan Portal Data SSO
      </a>
      <a class="back-link" href="./">
        <i class="fa-solid fa-arrow-left"></i> Kembali ke Portal Siswa
      </a>
    </section>
  </main>
</body>
</html>
<?php return ob_get_clean();
