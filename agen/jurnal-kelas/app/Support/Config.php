<?php
namespace App\Support;

final class Config
{
    private array $items = [];
    public function __construct(private readonly string $path) {}
    public function get(string $key, mixed $default = null): mixed
    {
        [$file, $nested] = array_pad(explode('.', $key, 2), 2, null);
        if (!array_key_exists($file, $this->items)) $this->items[$file] = require $this->path.'/'.$file.'.php';
        if ($nested === null) return $this->items[$file];
        $value = $this->items[$file];
        foreach (explode('.', $nested) as $segment) { if (!is_array($value) || !array_key_exists($segment, $value)) return $default; $value = $value[$segment]; }
        return $value;
    }
}
