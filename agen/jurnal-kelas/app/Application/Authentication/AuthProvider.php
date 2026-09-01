<?php
namespace App\Application\Authentication;

interface AuthProvider
{
    public function authorizationUrl(): string;
    public function authenticateCallback(string $code, string $state): array;
    public function logoutUrl(string $state): string;
}
