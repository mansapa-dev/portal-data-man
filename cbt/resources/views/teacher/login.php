<?php
declare(strict_types=1);
ob_start();
?>
<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login Guru - CBT MAN 1 Palembang</title><link rel="stylesheet" href="assets/css/teacher.css"></head>
<body class="auth-page"><main class="auth-card"><section class="auth-visual"><div class="school-mark">MAN 1</div><h1>Portal Guru CBT</h1><p>Monitoring ujian dan hasil peserta MAN 1 Palembang.</p></section><section class="auth-form"><div><span class="eyebrow">CBT MAN 1 PALEMBANG</span><h2>Selamat datang</h2><p>Gunakan akun guru Portal Data untuk masuk.</p></div><a class="sso-button" href="../auth/sso/start">Masuk dengan Portal Data</a><a class="back-link" href="./">Kembali ke portal siswa</a></section></main></body></html>
<?php return ob_get_clean();
