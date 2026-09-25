import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CheckInUseCase } from '../../application/use-cases/checkin.use-case';
import type { AccessTokenClaims } from '../../application/ports/services';
import { CurrentUser } from '../guards/jwt-auth.guard';
import { MarkReadDto, SyncDto } from '../dto/person.dto';
import { requestContext } from '../request-context';

/** الرئيسية، أسبوع وصال، سجل الوصال، الإشعارات، والمزامنة */
@ApiTags('home')
@ApiBearerAuth()
@Controller()
export class HomeController {
  constructor(private readonly checkIns: CheckInUseCase) {}

  @Get('today')
  today(@CurrentUser() user: AccessTokenClaims) {
    return this.checkIns.today(user.userId);
  }

  @Get('week')
  week(@CurrentUser() user: AccessTokenClaims, @Query('start') start?: string, @Query('timezone') timezone?: string) {
    return this.checkIns.week(user.userId, { start, timezone });
  }

  @Get('logs')
  logs(
    @CurrentUser() user: AccessTokenClaims,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('personId') personId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.checkIns.logs(user.userId, {
      from,
      to,
      personId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('notifications')
  notifications(
    @CurrentUser() user: AccessTokenClaims,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.checkIns.listNotifications(user.userId, {
      unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('notifications/read')
  markRead(@CurrentUser() user: AccessTokenClaims, @Body() body: MarkReadDto) {
    return this.checkIns.markNotificationsRead(user.userId, body.all ? 'all' : (body.ids ?? []));
  }

  @Post('sync')
  sync(@CurrentUser() user: AccessTokenClaims, @Body() body: SyncDto, @Req() req: Request) {
    return this.checkIns.sync(user.userId, { operations: body.operations }, requestContext(req));
  }
}
