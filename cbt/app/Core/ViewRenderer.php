<?php

declare(strict_types=1);

namespace Cbt\Core;

use RuntimeException;

final class ViewRenderer
{
    private string $root;

    public function __construct(string $root)
    {
        $resolved = realpath($root);
        if ($resolved === false || ! is_dir($resolved)) {
            throw new RuntimeException('Direktori partial frontend tidak tersedia.');
        }
        $this->root = $resolved;
    }

    public function render(string $template): string
    {
        return $this->expand($template, []);
    }

    private function expand(string $template, array $stack): string
    {
        return preg_replace_callback('/\{\{>\s*([a-z0-9\/-]+\.html)\s*\}\}/i', function (array $match) use ($stack): string {
            $path = realpath($this->root.'/'.$match[1]);
            if ($path === false || ! str_starts_with($path, $this->root.DIRECTORY_SEPARATOR)) {
                throw new RuntimeException('Partial frontend tidak ditemukan: '.$match[1]);
            }
            if (in_array($path, $stack, true)) {
                throw new RuntimeException('Siklus partial frontend terdeteksi.');
            }

            return $this->expand((string) file_get_contents($path), [...$stack, $path]);
        }, $template) ?? $template;
    }
}
