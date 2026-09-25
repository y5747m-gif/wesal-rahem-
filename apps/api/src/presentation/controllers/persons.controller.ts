import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PersonStatus } from '@wesal/shared';
import { PersonUseCase } from '../../application/use-cases/person.use-case';
import { CheckInUseCase } from '../../application/use-cases/checkin.use-case';
import { TrustedContactUseCase } from '../../application/use-cases/trusted-contact.use-case';
import type { AccessTokenClaims } from '../../application/ports/services';
import { CurrentUser } from '../guards/jwt-auth.guard';
import {
  CreatePersonDto,
  ExceptionDto,
  InviteContactDto,
  PausePersonDto,
  RecordAttemptDto,
  RecordCheckInDto,
  ReportDeceasedDto,
  SnoozeDto,
  UpdatePersonDto,
} from '../dto/person.dto';
import { requestContext } from '../request-context';

@ApiTags('persons')
@ApiBearerAuth()
@Controller('persons')
export class PersonsController {
  constructor(
    private readonly persons: PersonUseCase,
    private readonly checkIns: CheckInUseCase,
    private readonly contacts: TrustedContactUseCase,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenClaims,
    @Query('q') q?: string,
    @Query('status') status?: PersonStatus | 'needs_check_in',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.persons.list(user.userId, {
      q,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post()
  create(@CurrentUser() user: AccessTokenClaims, @Body() body: CreatePersonDto, @Req() req: Request) {
    return this.persons.create(user.userId, body, requestContext(req));
  }

  @Get(':id')
  get(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.persons.get(user.userId, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Body() body: UpdatePersonDto, @Req() req: Request) {
    return this.persons.update(user.userId, id, body, requestContext(req));
  }

  @Delete(':id')
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Req() req: Request) {
    return this.persons.remove(user.userId, id, requestContext(req));
  }

  @Post(':id/pause')
  pause(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Body() body: PausePersonDto, @Req() req: Request) {
    return this.persons.pause(user.userId, id, body, requestContext(req));
  }

  @Post(':id/resume')
  resume(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Req() req: Request) {
    return this.persons.resume(user.userId, id, requestContext(req));
  }

  @Post(':id/report-deceased')
  reportDeceased(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Body() body: ReportDeceasedDto, @Req() req: Request) {
    return this.persons.reportDeceased(user.userId, id, body, requestContext(req));
  }

  @Get(':id/who-sees-me')
  whoSeesMe(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.persons.whoSeesMe(user.userId, id);
  }

  // ─── الاستثناءات ───
  @Post(':id/exceptions')
  addException(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Body() body: ExceptionDto, @Req() req: Request) {
    return this.persons.addException(user.userId, id, body, requestContext(req));
  }

  @Delete(':id/exceptions/:date')
  removeException(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Param('date') date: string) {
    return this.persons.removeException(user.userId, id, date);
  }

  @Get(':id/days/:date')
  dayEntries(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Param('date') date: string) {
    return this.persons.dayEntries(user.userId, id, date);
  }

  // ─── الاطمئنان ───
  @Post(':id/check-ins')
  recordCheckIn(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Body() body: RecordCheckInDto, @Req() req: Request) {
    return this.checkIns.record(user.userId, id, body, requestContext(req));
  }

  @Post(':id/attempts')
  recordAttempt(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Body() body: RecordAttemptDto, @Req() req: Request) {
    return this.checkIns.recordAttempt(user.userId, id, body, requestContext(req));
  }

  @Post(':id/snooze')
  snooze(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Body() body: SnoozeDto, @Req() req: Request) {
    return this.checkIns.snooze(user.userId, id, { ...body, minutes: body.minutes ?? 30 }, requestContext(req));
  }

  @Get(':id/check-ins')
  personLogs(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.checkIns.logs(user.userId, { personId: id, pageSize: 50 });
  }

  @Post(':id/web-check-in-link')
  webLink(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string) {
    return this.checkIns.createWebCheckInLink(user.userId, id);
  }

  // ─── الجهات الموثوقة ───
  @Post(':id/trusted-contacts/invite')
  invite(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Body() body: InviteContactDto, @Req() req: Request) {
    return this.contacts.invite(user.userId, { ...body, personId: id }, requestContext(req));
  }
}
