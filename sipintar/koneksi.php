<?php
$host = "localhost";
$user = "root";
$pass = "";
$db   = "sipintar_db";

$conn = mysqli_connect($host, $user, $pass, $db);

if (!$conn) {
    die(json_encode(["success" => false, "message" => "Koneksi database gagal!"]));
}
?>