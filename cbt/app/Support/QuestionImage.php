<?php
declare(strict_types=1);
namespace Cbt\Support;

final class QuestionImage
{
 private const MAX_BYTES = 2097152;
 private const MIME_EXTENSIONS = [
  'image/png' => 'png',
  'image/jpeg' => 'jpg',
  'image/gif' => 'gif',
  'image/webp' => 'webp',
 ];

 public static function persistInHtml(string $html): string
 {
  return (string)preg_replace_callback(
   '~(<img\b[^>]*\bsrc\s*=\s*)(["\'])(data:image/[^"\']+)\2~i',
   static fn(array $match): string => $match[1].$match[2].self::storeDataUrl($match[3]).$match[2],
   $html
  );
 }

 public static function storeDataUrl(string $dataUrl): string
 {
  if (!preg_match('~^data:(image/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$~i', $dataUrl, $match)) {
   throw new \InvalidArgumentException('Format gambar harus PNG, JPG, GIF, atau WebP.');
  }
  $encoded = preg_replace('/\s+/', '', $match[2]);
  $binary = base64_decode((string)$encoded, true);
  if ($binary === false || $binary === '') throw new \InvalidArgumentException('Data gambar tidak valid.');
  if (strlen($binary) > self::MAX_BYTES) throw new \InvalidArgumentException('Ukuran gambar maksimal 2 MB.');
  $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer($binary);
  if (!isset(self::MIME_EXTENSIONS[$mime])) throw new \InvalidArgumentException('Isi file bukan gambar PNG, JPG, GIF, atau WebP yang valid.');
  $directory = dirname(__DIR__, 2).'/public/assets/uploads/questions';
  if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) throw new \RuntimeException('Folder upload gambar soal tidak dapat dibuat.');
  $name = hash('sha256', $binary).'.'.self::MIME_EXTENSIONS[$mime];
  $path = $directory.'/'.$name;
  if (!is_file($path) && file_put_contents($path, $binary, LOCK_EX) !== strlen($binary)) throw new \RuntimeException('Gambar soal gagal disimpan.');
  return 'assets/uploads/questions/'.$name;
 }
}
