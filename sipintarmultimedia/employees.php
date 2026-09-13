<?php
require __DIR__.'/app/bootstrap.php';
if (!sip_user()) sip_fail(401,'Silakan login.');
$q=trim($_GET['q'] ?? '');
$rows=sip_identity()->query('SELECT public_id,name,nip FROM employees WHERE active=1 AND (name LIKE ? OR nip LIKE ?) ORDER BY name LIMIT 30',['%'.$q.'%','%'.$q.'%'])->fetchAll(PDO::FETCH_ASSOC);
header('Content-Type: application/json'); echo json_encode(['success'=>true,'data'=>$rows]);
