<?php
declare(strict_types=1);
namespace Cbt\Integrations\PortalData;
interface PortalDataClientInterface
{
 public function students(int$page,int$limit):array;
 public function teachers(int$page,int$limit):array;
 public function classes(int$page,int$limit):array;
 public function academicYears():array;
 public function semesters(?string$academicYearId=null):array;
}
