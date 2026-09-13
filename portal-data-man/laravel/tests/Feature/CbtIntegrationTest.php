<?php

namespace Tests\Feature;

use App\Http\Controllers\CbtIntegrationController;
use App\Models\{AcademicYear, ClassEnrollment, SchoolClass, Semester, Student, Teacher};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class CbtIntegrationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->assertSame(':memory:', config('database.connections.sqlite.database'));
        (require database_path('migrations/2026_08_30_000000_create_portal_data_schema.php'))->up();
    }

    private function revisions(): array
    {
        return app(CbtIntegrationController::class)->revisions()->getData(true)['data'];
    }

    public function test_revision_endpoint_requires_a_service_token(): void
    {
        $this->getJson('/api/v1/integration/cbt/revisions')->assertUnauthorized();
    }

    public function test_bulk_edits_and_deletions_change_revisions_without_model_events(): void
    {
        $student = Student::create(['nisn'=>'0000000001', 'fullName'=>'Siswa Aktif', 'status'=>'ACTIVE']);
        $teacher = Teacher::create(['fullName'=>'Guru Aktif', 'status'=>'ACTIVE']);
        $before = $this->revisions();
        $this->assertSame($before, $this->revisions());
        // Deliberately bypass timestamps and observers, as bulk imports may do.
        DB::table('Student')->where('id', $student->id)->update(['fullName'=>'Nama Baru']);
        $after = $this->revisions();
        $this->assertNotSame($before['STUDENTS'], $after['STUDENTS']);
        $this->assertSame($before['TEACHERS'], $after['TEACHERS']);
        DB::table('Teacher')->where('id', $teacher->id)->update(['deletedAt'=>now()]);
        $this->assertNotSame($after['TEACHERS'], $this->revisions()['TEACHERS']);
        DB::table('Student')->delete();
        $this->assertNotSame($after['STUDENTS'], $this->revisions()['STUDENTS']);
    }

    public function test_only_active_students_and_teachers_are_exported(): void
    {
        foreach (['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED', 'DROPPED_OUT'] as $i=>$status) {
            Student::create(['nisn'=>str_pad((string)$i,10,'0',STR_PAD_LEFT), 'fullName'=>$status, 'status'=>$status]);
        }
        $deleted = Student::create(['nisn'=>'9999999999', 'fullName'=>'Deleted', 'status'=>'ACTIVE']);
        $deleted->delete();
        Teacher::create(['fullName'=>'Active Teacher', 'status'=>'ACTIVE']);
        Teacher::create(['fullName'=>'Inactive Teacher', 'status'=>'INACTIVE']);
        $controller = app(CbtIntegrationController::class);
        $students = $controller->students(Request::create('/'))->getData(true)['data'];
        $teachers = $controller->teachers(Request::create('/'))->getData(true)['data'];
        $this->assertSame(1, $students['total']);
        $this->assertSame('ACTIVE', $students['data'][0]['status']);
        $this->assertSame(1, $teachers['total']);
        $this->assertArrayNotHasKey('parentPhone', $students['data'][0]);
    }

    public function test_class_changes_invalidate_student_revision_and_export_current_class(): void
    {
        $year = AcademicYear::create(['name'=>'2026/2027', 'startDate'=>'2026-07-01', 'endDate'=>'2027-06-30', 'isActive'=>true]);
        $semester = Semester::create(['academicYearId'=>$year->id, 'type'=>'ODD', 'startDate'=>'2026-07-01', 'endDate'=>'2026-12-31', 'isActive'=>true]);
        $class = SchoolClass::create(['academicYearId'=>$year->id, 'code'=>'X-A', 'name'=>'X A', 'gradeLevel'=>10]);
        $student = Student::create(['nisn'=>'0000000001', 'fullName'=>'Siswa']);
        ClassEnrollment::create(['studentId'=>$student->id, 'schoolClassId'=>$class->id, 'academicYearId'=>$year->id, 'semesterId'=>$semester->id, 'status'=>'ACTIVE']);
        $before = $this->revisions();
        DB::table('SchoolClass')->where('id',$class->id)->update(['name'=>'X Unggulan']);
        $after = $this->revisions();
        $this->assertNotSame($before['STUDENTS'], $after['STUDENTS']);
        $this->assertNotSame($before['CLASSES'], $after['CLASSES']);
        $row = app(CbtIntegrationController::class)->students(Request::create('/'))->getData(true)['data']['data'][0];
        $this->assertSame('X Unggulan', $row['class']['name']);
        $this->assertSame('X', $row['grade']);
        $this->assertSame('2026/2027', $row['academic_year']);
    }
}
