<?php
namespace Tests\Feature;
use PHPUnit\Framework\TestCase;
final class OutputEscapingTest extends TestCase
{
    public function test_html_and_attribute_payload_is_escaped():void{self::assertSame('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',e('<script>alert("x")</script>'));}
}
