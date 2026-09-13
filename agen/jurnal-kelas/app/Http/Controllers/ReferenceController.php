<?php
namespace App\Http\Controllers;
use App\Http\Request;
use App\Http\Response;
use App\Infrastructure\PortalData\PortalDataClient;
final class ReferenceController
{
    public function __construct(private readonly PortalDataClient $portal) {}
    public function classes(Request $request): Response { return $this->reference($request, 'classes'); }
    public function periods(Request $request): Response { return $this->reference($request, 'periods'); }
    private function reference(Request $request, string $key): Response
    {
        if ($request->input('refresh') === '1') {
            if (!isset($_SESSION['portal_access_token']) || (int)($_SESSION['portal_access_expires_at'] ?? 0) <= time()+5) {
                return Response::json(['success'=>false,'message'=>'Token Portal Data berakhir. Silakan login kembali.'],401);
            }
            try {
                $_SESSION['portal_reference'][$key] = $this->portal->{$key}((string)$_SESSION['portal_access_token']);
                $_SESSION['portal_reference']['synced_at'] = time();
            } catch (\RuntimeException $error) {
                return Response::json(['success'=>false,'message'=>$error->getMessage()],502);
            }
        }
        return Response::json(['success'=>true,'data'=>$_SESSION['portal_reference'][$key] ?? [],'meta'=>['syncedAt'=>$_SESSION['portal_reference']['synced_at'] ?? null]]);
    }
    public function students(Request $request):Response
    {
        if(!isset($_SESSION['portal_access_token'],$_SESSION['portal_access_expires_at'])||(int)$_SESSION['portal_access_expires_at']<=time()+5)return Response::json(['success'=>false,'message'=>'Token Portal Data berakhir. Silakan login kembali.'],401);
        $semester=$request->input('semesterPublicId'); $data=$this->portal->classStudents((string)$request->attribute('publicId'),(string)$_SESSION['portal_access_token'],is_string($semester)?$semester:null); return Response::json(['success'=>true,'data'=>$data]);
    }
}
