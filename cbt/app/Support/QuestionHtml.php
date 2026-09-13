<?php
declare(strict_types=1);
namespace Cbt\Support;

final class QuestionHtml
{
 public static function clean(?string $html): string
 {
  if ($html === null || $html === '') return '';
  $document = new \DOMDocument('1.0', 'UTF-8');
  $previous = libxml_use_internal_errors(true);
  try { $document->loadHTML('<?xml encoding="UTF-8"><html><body>'.$html.'</body></html>', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING); }
  finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
  $body = $document->getElementsByTagName('body')->item(0);
  if (!$body) return htmlspecialchars($html, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
  $clean = function (\DOMNode $parent) use (&$clean): void {
   foreach (iterator_to_array($parent->childNodes) as $node) {
    if ($node instanceof \DOMText) continue;
    if (!$node instanceof \DOMElement) { $parent->removeChild($node); continue; }
    $tag = strtolower($node->tagName);
    if (!in_array($tag, ['p','br','b','strong','i','em','u','s','sub','sup','ul','ol','li','table','thead','tbody','tr','td','th','span','div','img'], true)) { $parent->removeChild($node); continue; }
    $src = $tag === 'img' ? $node->getAttribute('src') : '';
    $alt = $node->getAttribute('alt');
    foreach (iterator_to_array($node->attributes) as $attribute) $node->removeAttributeNode($attribute);
    if ($tag === 'img') {
     $relative = preg_match('~^(?![/\\\\]{2})(?:/?[A-Za-z0-9_-])[A-Za-z0-9_./?=&%+#-]*$~D', $src) === 1;
     $data = strlen($src) <= 2000000 && preg_match('~^data:image/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$~D', $src) === 1;
     if (!$relative && !$data) { $parent->removeChild($node); continue; }
     $node->setAttribute('src', $src); $node->setAttribute('alt', $alt);
     $node->setAttribute('style', 'max-width:100%;max-height:280px;object-fit:contain');
    }
    $clean($node);
   }
  };
  $clean($body); $result = '';
  foreach ($body->childNodes as $node) $result .= $document->saveHTML($node);
  return $result;
 }
 public static function row(array $row): array
 {
  foreach (['pertanyaan','opsi_a','opsi_b','opsi_c','opsi_d','opsi_e'] as $key) if (isset($row[$key])) $row[$key] = self::clean((string)$row[$key]);
  return $row;
 }
}
