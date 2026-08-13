import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('api/health')
  getHealth() {
    return {
      ok: true,
      blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      time: new Date().toISOString(),
    };
  }
}
