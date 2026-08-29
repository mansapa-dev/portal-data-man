import { StudentStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
export class CreateStudentDto { @Matches(/^\d{10}$/,{message:'NISN harus terdiri dari 10 digit.'}) nisn!:string; @IsString() @MinLength(2) @MaxLength(191) fullName!:string; @IsOptional() @IsString() parentPhone?:string; @IsOptional() @IsString() address?:string; @IsOptional() @Matches(/^[0-9A-F]+$/i) rfidUid?:string; @IsOptional() @IsEnum(StudentStatus) status?:StudentStatus; }
export class UpdateStudentDto extends CreateStudentDto { @IsOptional() declare nisn:string; @IsOptional() declare fullName:string; }
export class StudentQueryDto extends PaginationDto { @IsOptional() @IsString() search?:string; @IsOptional() @Matches(/^\d{10}$/) nisn?:string; @IsOptional() @IsString() classPublicId?:string; @IsOptional() @IsString() academicYearPublicId?:string; @IsOptional() @IsString() semesterPublicId?:string; @IsOptional() @IsEnum(StudentStatus) status?:StudentStatus; @IsOptional() @IsIn(['fullName','nisn','status','createdAt','updatedAt']) sortBy='fullName'; }
