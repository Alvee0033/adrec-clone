import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [AdminModule],
  controllers: [AuthController],
})
export class AuthModule {}
