<?php
declare(strict_types=1);
namespace Cbt\Support;

final class QuestionHtml
{
 public static function clean(?string $html): string
 {
  if ($html === null || $html === '') return '';
  if (!class_exists(\DOMDocument::class)) return self::cleanWithoutDom($html);
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
    $mathTags=['math','mrow','mi','mn','mo','mtext','mspace','mfrac','msqrt','mroot','msub','msup','msubsup','munder','mover','munderover','mmultiscripts','mprescripts','none','mtable','mtr','mtd','menclose','mpadded','mphantom'];
    if (!in_array($tag, array_merge(['p','br','b','strong','i','em','u','s','sub','sup','ul','ol','li','table','thead','tbody','tr','td','th','span','div','img'],$mathTags), true)) { $parent->removeChild($node); continue; }
    $src = $tag === 'img' ? $node->getAttribute('src') : '';
    $alt = $node->getAttribute('alt');
    $safeMathAttributes=[];
    if(in_array($tag,$mathTags,true))foreach(['display','xmlns','width','accent','accentunder','notation','linethickness','bevelled']as$attributeName)if($node->hasAttribute($attributeName))$safeMathAttributes[$attributeName]=$node->getAttribute($attributeName);
    foreach (iterator_to_array($node->attributes) as $attribute) $node->removeAttributeNode($attribute);
    if ($tag === 'img') {
     $relative = preg_match('~^(?![/\\\\]{2})(?:/?[A-Za-z0-9_-])[A-Za-z0-9_./?=&%+#-]*$~D', $src) === 1;
     $data = strlen($src) <= 2000000 && preg_match('~^data:image/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$~D', $src) === 1;
     if (!$relative && !$data) { $parent->removeChild($node); continue; }
     $node->setAttribute('src', $src); $node->setAttribute('alt', $alt);
     $node->setAttribute('style', 'max-width:100%;max-height:280px;object-fit:contain');
    }
    foreach($safeMathAttributes as$attributeName=>$attributeValue)$node->setAttribute($attributeName,$attributeValue);
    if($tag==='math')$node->setAttribute('display','inline');
    $clean($node);
   }
  };
  $clean($body); $result = '';
  foreach ($body->childNodes as $node) $result .= $document->saveHTML($node);
  return $result;
 }
 private static function cleanWithoutDom(string $html): string
 {
  // Keep only images already saved into our controlled upload directory when
  // shared hosting lacks ext-dom. All other markup still becomes plain text.
  $images=[];
  $html=preg_replace_callback('~<img\b[^>]*>~i',static function(array $match)use(&$images):string{
   $fallback=preg_match('~\balt\s*=\s*(["\'])(.*?)\1~is',$match[0],$description)?' '.html_entity_decode($description[2],ENT_QUOTES|ENT_HTML5,'UTF-8').' ':'';
   if(!preg_match('~\bsrc\s*=\s*(["\'])(.*?)\1~is',$match[0],$source))return $fallback;
   $src=html_entity_decode($source[2],ENT_QUOTES|ENT_HTML5,'UTF-8');
   if(!preg_match('~^assets/uploads/questions/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$~D',$src))return $fallback;
   $placeholder='CBT_SAFE_IMAGE_'.count($images).'_END';
   $images[$placeholder]='<img src="'.htmlspecialchars($src,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8').'" alt="Gambar soal" style="max-width:100%;max-height:280px;object-fit:contain">';
   return $placeholder;
  },$html)??$html;
  $html = preg_replace('~<(script|style|iframe|object|embed)\b[^>]*>.*?</\1\s*>~is', '', $html) ?? '';
  $html = preg_replace_callback('~<img\b[^>]*\balt\s*=\s*(["\'])(.*?)\1[^>]*>~is', static fn(array $match): string => ' '.html_entity_decode($match[2], ENT_QUOTES | ENT_HTML5, 'UTF-8').' ', $html) ?? $html;
  $html = preg_replace('~<\s*(?:br\s*/?|/p|/div|/li|/tr)\s*>~i', "\n", $html) ?? $html;
  $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
  $text = preg_replace("~[\t ]+~", ' ', $text) ?? $text;
  $text = preg_replace("~\n{3,}~", "\n\n", $text) ?? $text;
  return strtr(nl2br(htmlspecialchars(trim($text), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'), false),$images);
 }
 public static function row(array $row): array
 {
  foreach (['pertanyaan','opsi_a','opsi_b','opsi_c','opsi_d','opsi_e'] as $key) if (isset($row[$key])) $row[$key] = self::clean((string)$row[$key]);
  return $row;
 }
}
