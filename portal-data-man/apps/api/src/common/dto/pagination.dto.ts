import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
export class PaginationDto {
 @IsOptional() @Transform(({value})=>Number(value)) @IsInt() @Min(1) page=1;
 @IsOptional() @Transform(({value})=>Number(value)) @IsInt() @Min(1) @Max(100) perPage=25;
 @IsOptional() @IsIn(['asc','desc']) sortDirection:'asc'|'desc'='asc';
}
