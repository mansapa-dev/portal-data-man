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
  // Shared hosting may lack ext-dom. Rebuild a small allowlist of markup so
  // sub/sup, MathML and saved images survive without preserving unsafe input.
  $html=preg_replace('~<(script|style|iframe|object|embed|svg|form)\b[^>]*>.*?</\1\s*>~is','',$html)??$html;
  $mathTags=['math','mrow','mi','mn','mo','mtext','mspace','mfrac','msqrt','mroot','msub','msup','msubsup','munder','mover','munderover','mmultiscripts','mprescripts','none','mtable','mtr','mtd','menclose','mpadded','mphantom'];
  $allowed=array_merge(['p','br','b','strong','i','em','u','s','sub','sup','ul','ol','li','table','thead','tbody','tr','td','th','span','div','img'],$mathTags);
  $pieces=preg_split('~(<[^>]*>)~s',$html,-1,PREG_SPLIT_DELIM_CAPTURE)?:[];
  $result='';$stack=[];
  foreach($pieces as$piece){
   if($piece==='' )continue;
   if($piece[0]!=='<'){$result.=nl2br(htmlspecialchars(html_entity_decode($piece,ENT_QUOTES|ENT_HTML5,'UTF-8'),ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8'),false);continue;}
   if(!preg_match('~^<\s*(/?)\s*([a-z][a-z0-9]*)\b([^>]*)>$~i',$piece,$tagMatch))continue;
   $closing=$tagMatch[1]==='/';$tag=strtolower($tagMatch[2]);$attributes=$tagMatch[3];
   if(!in_array($tag,$allowed,true))continue;
   if($closing){
    $position=array_search($tag,array_reverse($stack),true);
    if($position===false)continue;
    for($i=0;$i<=$position;$i++)$result.='</'.array_pop($stack).'>';
    continue;
   }
   if($tag==='img'){
    $alt=preg_match('~\balt\s*=\s*(["\'])(.*?)\1~is',$attributes,$altMatch)?html_entity_decode($altMatch[2],ENT_QUOTES|ENT_HTML5,'UTF-8'):'';
    $src=preg_match('~\bsrc\s*=\s*(["\'])(.*?)\1~is',$attributes,$srcMatch)?html_entity_decode($srcMatch[2],ENT_QUOTES|ENT_HTML5,'UTF-8'):'';
    if(preg_match('~^assets/uploads/questions/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$~D',$src))$result.='<img src="'.htmlspecialchars($src,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8').'" alt="Gambar soal" style="max-width:100%;max-height:280px;object-fit:contain">';
    elseif($alt!=='')$result.=htmlspecialchars($alt,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');
    continue;
   }
   if($tag==='br'){$result.='<br>';continue;}
   $safeAttributes='';
   if($tag==='math')$safeAttributes=' xmlns="http://www.w3.org/1998/Math/MathML" display="inline"';
   elseif($tag==='mspace'&&preg_match('~\bwidth\s*=\s*(["\'])([0-9]+(?:\.[0-9]+)?(?:em|ex|px|%))\1~i',$attributes,$width))$safeAttributes=' width="'.$width[2].'"';
   elseif($tag==='menclose'&&preg_match('~\bnotation\s*=\s*(["\'])(box|circle|longdiv)\1~i',$attributes,$notation))$safeAttributes=' notation="'.$notation[2].'"';
   elseif($tag==='mfrac'&&preg_match('~\blinethickness\s*=\s*(["\'])0\1~i',$attributes))$safeAttributes=' linethickness="0"';
   elseif(in_array($tag,['mover','munder'],true)&&preg_match('~\baccent(?:under)?\s*=\s*(["\'])true\1~i',$attributes))$safeAttributes=$tag==='mover'?' accent="true"':' accentunder="true"';
   $selfClosing=preg_match('~/\s*$~',$attributes)===1||in_array($tag,['mprescripts','none'],true);
   $result.='<'.$tag.$safeAttributes.($selfClosing?'/':'').'>';
   if(!$selfClosing)$stack[]=$tag;
  }
  while($stack)$result.='</'.array_pop($stack).'>';
  return $result;
 }
 public static function row(array $row): array
 {
  foreach (['pertanyaan','opsi_a','opsi_b','opsi_c','opsi_d','opsi_e'] as $key) if (isset($row[$key])) $row[$key] = self::clean((string)$row[$key]);
  return $row;
 }
}
