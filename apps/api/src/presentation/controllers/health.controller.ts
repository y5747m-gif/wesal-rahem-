import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { DataSource } from 'typeorm';
import type { HealthResponse } from '@wesal/shared';
import { DATA_SOURCE } from '../../infrastructure/persistence/repository-tokens';
import { Public } from '../guards/jwt-auth.guard';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  async health(): Promise<HealthResponse> {
    let database: HealthResponse['database'] = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      time: new Date().toISOString(),
      database,
    };
  }
}
