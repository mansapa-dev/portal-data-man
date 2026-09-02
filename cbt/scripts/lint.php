<?php
declare(strict_types=1);
$root=dirname(__DIR__);$directories=['app','config','routes','public'];$failed=false;
foreach($directories as$directory){$path=$root.'/'.$directory;if(!is_dir($path))continue;$files=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path));foreach($files as$file){if($file->getExtension()!=='php')continue;$command=escapeshellarg(PHP_BINARY).' -l '.escapeshellarg($file->getPathname());exec($command,$output,$code);echo implode(PHP_EOL,$output).PHP_EOL;$output=[];if($code!==0)$failed=true;}}
exit($failed?1:0);
