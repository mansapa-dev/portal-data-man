<?php
declare(strict_types=1);
$root = dirname(__DIR__); $failed = 0;
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $file) { if ($file->getExtension() !== 'php' || str_contains($file->getPathname(), DIRECTORY_SEPARATOR.'vendor'.DIRECTORY_SEPARATOR)) continue; passthru(escapeshellarg(PHP_BINARY).' -l '.escapeshellarg($file->getPathname()), $code); if ($code !== 0) $failed++; }
exit($failed > 0 ? 1 : 0);
