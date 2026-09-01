<?php
namespace App\Support;

use Closure;
use ReflectionClass;
use RuntimeException;

final class Container
{
    private array $bindings = [];
    private array $instances = [];
    public function singleton(string $id, Closure $factory): void { $this->bindings[$id] = $factory; }
    public function instance(string $id, object $instance): void { $this->instances[$id] = $instance; }
    public function get(string $id): object
    {
        if (isset($this->instances[$id])) return $this->instances[$id];
        if (isset($this->bindings[$id])) return $this->instances[$id] = ($this->bindings[$id])($this);
        $reflection = new ReflectionClass($id);
        if (!$reflection->isInstantiable()) throw new RuntimeException("Service {$id} tidak dapat dibuat.");
        $constructor = $reflection->getConstructor();
        if (!$constructor) return new $id();
        $dependencies = array_map(function ($parameter) {
            $type = $parameter->getType();
            if (!$type || $type->isBuiltin()) throw new RuntimeException("Dependency {$parameter->getName()} tidak dapat di-resolve.");
            return $this->get($type->getName());
        }, $constructor->getParameters());
        return $reflection->newInstanceArgs($dependencies);
    }
}
