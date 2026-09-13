<?php
declare(strict_types=1);
namespace Cbt\Support;

final class QuestionFingerprint
{
 public static function fromHtml(string$html):string
 {
  preg_match_all('~<img\b[^>]*\bsrc=["\']([^"\']+)["\']~iu',$html,$matches);
  $text=html_entity_decode(strip_tags($html),ENT_QUOTES|ENT_HTML5,'UTF-8');
  $text=preg_replace('/\s+/u',' ',trim($text))??trim($text);
  $text=function_exists('mb_strtolower')?mb_strtolower($text,'UTF-8'):strtolower($text);
  $images=array_map(static fn(string$src):string=>trim($src),$matches[1]??[]);
  return hash('sha256',$text."\n".implode("\n",$images));
 }
}
