import { Controller, Post, Body, Res, Get, Put, UseGuards, UnauthorizedException, BadRequestException, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { AdminService } from '../admin/admin.service';
import { AuthGuard } from './auth.guard';
import * as crypto from 'crypto';

@Controller('api')
export class AuthController {
  constructor(private readonly adminService: AdminService) {}

  @Post('login')
  async login(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const { username, password } = body || {};
    const admin = await this.adminService.findByUsername(username);
    
    if (admin && admin.password === password) {
      const SECRET_KEY = process.env.JWT_SECRET || 'adrec-clone-super-secret-key-12345';
      const expiresAt = Date.now() + 3600000 * 24 * 30; // 30 days
      const payload = `${admin.id}.${admin.username}.${expiresAt}`;
      const signature = crypto.createHmac('sha256', SECRET_KEY + admin.password).update(payload).digest('hex');
      const token = Buffer.from(`${payload}.${signature}`).toString('base64url');
      
      await this.adminService.updateToken(admin.id, token);
      
      res.cookie('admin_token', token, {
        httpOnly: true,
        secure: false,
        maxAge: 3600000 * 24 * 30, // 30 days
      });
      return { token };
    } else {
      throw new BadRequestException('Invalid username or password');
    }
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('admin_token');
    return { success: true };
  }

  @UseGuards(AuthGuard)
  @Get('admin/me')
  getMe(@Req() req: Request & { admin: any }) {
    return { username: req.admin.username };
  }

  @UseGuards(AuthGuard)
  @Put('admin/settings')
  async updateSettings(@Body() body: any, @Req() req: Request & { admin: any }) {
    const { username, password } = body || {};
    if (!username || !password) {
      throw new BadRequestException('Username and password required');
    }
    const updated = await this.adminService.updateCredentials(req.admin.id, String(username), String(password));
    return { success: true, token: updated?.token || '' };
  }
}
