<?php

namespace Tests\Unit;

use App\Infrastructure\PortalData\HttpClient;
use App\Infrastructure\PortalData\OidcAuthProvider;
use App\Infrastructure\Security\JwkVerifier;
use App\Support\Config;
use PHPUnit\Framework\TestCase;

final class OidcLogoutUrlTest extends TestCase
{
    protected function tearDown(): void
    {
        unset($_ENV['PORTAL_DATA_ISSUER'], $_ENV['PORTAL_DATA_POST_LOGOUT_REDIRECT_URI']);
        parent::tearDown();
    }

    public function test_logout_url_does_not_require_a_server_side_discovery_request(): void
    {
        $_ENV['PORTAL_DATA_ISSUER']='https://portal.example.test/oidc';
        $_ENV['PORTAL_DATA_POST_LOGOUT_REDIRECT_URI']='https://agen.example.test/login';
        $provider=new OidcAuthProvider(new Config(dirname(__DIR__,2).'/config'),new HttpClient,new JwkVerifier);

        $url=$provider->logoutUrl('logout-state');

        self::assertStringStartsWith('https://portal.example.test/oidc/logout?', $url);
        parse_str((string)parse_url($url,PHP_URL_QUERY),$query);
        self::assertSame('https://agen.example.test/login',$query['post_logout_redirect_uri']);
        self::assertSame('logout-state',$query['state']);
    }
}
