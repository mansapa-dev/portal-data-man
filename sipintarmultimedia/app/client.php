<?php
if (!function_exists('sip_user')) { http_response_code(404); exit; }
$sipUser=sip_user(); $sipApp=\Sipintar\Identity::APP;
$sipPermissions=array_values(array_filter(\Sipintar\Identity::PERMISSIONS,fn($p)=>sip_identity()->allows($sipUser,$sipApp,$p)));
?>
<script>
window.sipSession=<?= json_encode(['csrf'=>sip_csrf(),'app'=>$sipApp,'base'=>sip_base_path(),'user'=>$sipUser ? ['id'=>$sipUser['id'],'name'=>$sipUser['name'],'superadmin'=>(bool)$sipUser['superadmin_slot']] : null,'permissions'=>$sipPermissions],JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT) ?>;
</script>
<script src="<?= sip_e(sip_base_path()) ?>/assets/client.js"></script>
