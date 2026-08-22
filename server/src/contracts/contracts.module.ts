import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract } from './contract.entity';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([Contract]), StorageModule],
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
