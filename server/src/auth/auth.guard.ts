import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminService } from '../admin/admin.service';
import * as crypto from 'crypto';

const SECRET_KEY = process.env.JWT_SECRET || 'adrec-clone-super-secret-key-12345';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private adminService: AdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    let token = request.cookies?.admin_token || request.headers['authorization'];
    
    if (!token && request.headers['cookie']) {
      const match = request.headers['cookie'].match(/admin_token=([^;]+)/);
      if (match) token = match[1];
    }

    if (token && token.startsWith('Bearer ')) {
      token = token.slice(7);
    }
    
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    // Try verifying as cryptographically signed session first (supports multi-device)
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const parts = decoded.split('.');
      if (parts.length === 4) {
        const [adminId, username, expiresAt, signature] = parts;
        const admin = await this.adminService.findById(parseInt(adminId, 10));
        if (admin) {
          const payload = `${adminId}.${username}.${expiresAt}`;
          const expectedSignature = crypto.createHmac('sha256', SECRET_KEY + admin.password).update(payload).digest('hex');
          if (signature === expectedSignature && Date.now() <= parseInt(expiresAt, 10)) {
            request.admin = admin;
            return true;
          }
        }
      }
    } catch (e) {
      // Fallback to legacy database lookup
    }

    const admin = await this.adminService.findByToken(token);
    if (!admin) {
      throw new UnauthorizedException('Invalid token');
    }

    request.admin = admin;
    return true;
  }
}
