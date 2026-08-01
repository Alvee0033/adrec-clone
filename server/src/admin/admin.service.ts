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
    const adminCount = await this.adminRepository.count();
    if (adminCount === 0) {
      const admin = new Admin();
      admin.username = 'admin';
      admin.password = 'admin123';
      admin.token = 'super-secret-admin-token';
      await this.adminRepository.save(admin);
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
