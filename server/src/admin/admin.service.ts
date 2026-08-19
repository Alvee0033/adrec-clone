import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Admin } from './admin.entity';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
  ) {}

  async onModuleInit() {
    // Only create default admin if no admin account exists yet (first boot only)
    // NEVER reset credentials on restart — user's custom password must be preserved
    const exists = await this.adminRepository.findOne({ where: { username: 'admin' } });
    if (!exists) {
      const admin = new Admin();
      admin.username = 'admin';
      admin.password = 'admin123';
      admin.token = 'super-secret-admin-token';
      await this.adminRepository.save(admin);
    } else if (process.env.RESET_ADMIN_PASSWORD) {
      // Emergency reset: set RESET_ADMIN_PASSWORD env var in Coolify to override password
      exists.password = process.env.RESET_ADMIN_PASSWORD;
      await this.adminRepository.save(exists);
      console.log('[AdminService] Admin password reset via RESET_ADMIN_PASSWORD env var');
    }
  }

  async findByUsername(username: string): Promise<Admin | null> {
    return this.adminRepository.findOne({ where: { username } });
  }

  async findById(id: number): Promise<Admin | null> {
    return this.adminRepository.findOne({ where: { id } });
  }

  async findByToken(token: string): Promise<Admin | null> {
    return this.adminRepository.findOne({ where: { token } });
  }

  async updateToken(id: number, token: string): Promise<Admin | null> {
    await this.adminRepository.update(id, { token });
    return this.adminRepository.findOne({ where: { id } });
  }

  async updateCredentials(id: number, username: string, password?: string): Promise<Admin | null> {
    const updateData: Partial<Admin> = { username };
    if (password) {
      updateData.password = password;
    }
    updateData.token = crypto.randomBytes(16).toString('hex');
    await this.adminRepository.update(id, updateData);
    return this.adminRepository.findOne({ where: { id } });
  }
}
