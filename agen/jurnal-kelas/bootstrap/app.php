<?php

declare(strict_types=1);

use App\Infrastructure\Database\Connection;
use App\Application\Authentication\AuthProvider;
use App\Infrastructure\PortalData\HttpClient;
use App\Infrastructure\PortalData\OidcAuthProvider;
use App\Infrastructure\Security\JwkVerifier;
use App\Support\Config;
use App\Support\Container;
use Dotenv\Dotenv;

$root = dirname(__DIR__);
require $root.'/vendor/autoload.php';
require_once $root.'/app/Support/helpers.php';
if (is_file($root.'/.env')) Dotenv::createImmutable($root)->safeLoad();
$config = new Config($root.'/config');
date_default_timezone_set((string) $config->get('app.timezone', 'Asia/Jakarta'));
$container = new Container();
$container->instance(Config::class, $config);
$container->singleton(Connection::class, fn (Container $c) => new Connection($c->get(Config::class)));
$container->singleton(AuthProvider::class, fn (Container $c) => new OidcAuthProvider($c->get(Config::class), $c->get(HttpClient::class), $c->get(JwkVerifier::class)));
return $container;
