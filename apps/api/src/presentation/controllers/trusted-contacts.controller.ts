import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { detectLocaleFromAcceptLanguage } from '@wesal/shared';
import { TrustedContactUseCase } from '../../application/use-cases/trusted-contact.use-case';
import { CheckInUseCase } from '../../application/use-cases/checkin.use-case';
import type { AccessTokenClaims } from '../../application/ports/services';
import { CurrentUser, Public } from '../guards/jwt-auth.guard';
import { requestContext } from '../request-context';

@ApiTags('trusted-contacts')
@Controller()
export class TrustedContactsController {
  constructor(
    private readonly contacts: TrustedContactUseCase,
    private readonly checkIns: CheckInUseCase,
  ) {}

  // ─── من جهة المالك (تتطلب جلسة) ───
  @ApiBearerAuth()
  @Delete('invitations/:id')
  revoke(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Req() req: Request) {
    return this.contacts.revoke(user.userId, id, requestContext(req));
  }

  @ApiBearerAuth()
  @Delete('trusted-contacts/:id')
  remove(@CurrentUser() user: AccessTokenClaims, @Param('id') id: string, @Req() req: Request) {
    return this.contacts.remove(user.userId, id, requestContext(req));
  }

  // ─── من جهة المدعو (عام — بالرمز فقط) ───
  @Public()
  @Get('public/invites/:token')
  publicInvite(@Param('token') token: string, @Headers('accept-language') lang?: string) {
    return this.contacts.publicInvite(token, detectLocaleFromAcceptLanguage(lang));
  }

  @Public()
  @Post('public/invites/:token/accept')
  @HttpCode(200)
  accept(@Param('token') token: string, @Body() body: { phone?: string; locale?: 'ar' | 'en' }, @Headers('accept-language') lang?: string) {
    return this.contacts.accept(token, { phone: body?.phone, locale: body?.locale ?? detectLocaleFromAcceptLanguage(lang) });
  }

  @Public()
  @Post('public/invites/:token/decline')
  @HttpCode(200)
  decline(@Param('token') token: string, @Headers('accept-language') lang?: string) {
    return this.contacts.decline(token, detectLocaleFromAcceptLanguage(lang));
  }

  // ─── رابط "أنا بخير" (عام) ───
  @Public()
  @Get('public/fine/:token')
  fine(@Param('token') token: string, @Headers('accept-language') lang?: string) {
    return this.checkIns.publicWebCheckIn(token, detectLocaleFromAcceptLanguage(lang));
  }

  @Public()
  @Post('public/fine/:token')
  @HttpCode(200)
  confirmFine(@Param('token') token: string, @Headers('accept-language') lang?: string) {
    return this.checkIns.confirmWebCheckIn(token, detectLocaleFromAcceptLanguage(lang));
  }
}
