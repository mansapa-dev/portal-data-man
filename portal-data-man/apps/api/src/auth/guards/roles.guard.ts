import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
@Injectable() export class RolesGuard implements CanActivate { constructor(private reflector:Reflector){} canActivate(context:ExecutionContext){const roles=this.reflector.getAllAndOverride<AdminRole[]>(ROLES_KEY,[context.getHandler(),context.getClass()]);if(!roles?.length)return true;const user=context.switchToHttp().getRequest().user;if(!user||!roles.includes(user.role))throw new ForbiddenException('Anda tidak memiliki izin.');return true;} }
