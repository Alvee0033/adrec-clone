import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminService } from '../admin/admin.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private adminService: AdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    let token = request.cookies?.admin_token || request.headers['authorization'];
    if (token && token.startsWith('Bearer ')) {
      token = token.slice(7);
    }
    
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    const admin = await this.adminService.findByToken(token);
    if (!admin) {
      throw new UnauthorizedException('Invalid token');
    }

    request.admin = admin;
    return true;
  }
}
