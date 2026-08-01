import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin } from './admin.entity';
import { AdminService } from './admin.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Admin])],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
