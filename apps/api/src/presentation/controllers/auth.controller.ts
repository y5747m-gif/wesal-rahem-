import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUseCase } from '../../application/use-cases/auth.use-case';
import type { AccessTokenClaims } from '../../application/ports/services';
import { CurrentUser, Public } from '../guards/jwt-auth.guard';
import { DeviceDto, RefreshDto, RequestOtpDto, UpdateProfileDto, VerifyOtpDto } from '../dto/auth.dto';
import { requestContext } from '../request-context';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthUseCase) {}

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() body: RequestOtpDto, @Req() req: Request) {
    return this.auth.requestOtp({ phone: body.phone, locale: body.locale, context: requestContext(req) });
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() body: VerifyOtpDto, @Req() req: Request) {
    return this.auth.verifyOtp({
      phone: body.phone,
      code: body.code,
      locale: body.locale,
      timezone: body.timezone,
      displayName: body.displayName,
      device: body.device,
      context: requestContext(req),
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh({ refreshToken: body.refreshToken });
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: RefreshDto) {
    return this.auth.logout({ refreshToken: body.refreshToken });
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AccessTokenClaims) {
    return this.auth.getProfile(user.userId);
  }

  @ApiBearerAuth()
  @Patch('me')
  updateMe(@CurrentUser() user: AccessTokenClaims, @Body() body: UpdateProfileDto) {
    return this.auth.updateProfile(user.userId, body);
  }

  @ApiBearerAuth()
  @Post('devices')
  registerDevice(@CurrentUser() user: AccessTokenClaims, @Body() body: DeviceDto) {
    return this.auth.registerDevice(user.userId, body);
  }

  @ApiBearerAuth()
  @Delete('me')
  deleteAccount(@CurrentUser() user: AccessTokenClaims) {
    return this.auth.deleteAccount(user.userId);
  }
}
