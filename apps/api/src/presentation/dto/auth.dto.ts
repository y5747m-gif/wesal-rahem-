import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';
import { PHONE_E164_RE } from '@wesal/shared';

export class RequestOtpDto {
  @IsString()
  @Matches(PHONE_E164_RE, { message: 'phone must be E.164 (+9665xxxxxxxx)' })
  phone!: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  locale?: 'ar' | 'en';
}

export class DeviceDto {
  @IsIn(['ios', 'android', 'web'])
  platform!: 'ios' | 'android' | 'web';

  @IsOptional() @IsString() pushToken?: string;
  @IsOptional() @IsString() appVersion?: string;
  @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
  @IsOptional() @IsString() timezone?: string;
}

export class VerifyOtpDto extends RequestOtpDto {
  @IsString()
  @Length(4, 8)
  code!: string;

  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() @Length(1, 80) displayName?: string;
  @IsOptional() @IsObject() device?: DeviceDto;
}

export class RefreshDto {
  @IsString()
  @Length(16, 512)
  refreshToken!: string;
}

export class UpdateProfileDto {
  @IsOptional() displayName?: string | null;
  @IsOptional() email?: string | null;
  @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsIn(['light', 'dark', 'system']) theme?: 'light' | 'dark' | 'system';
  @IsOptional() @IsIn(['small', 'default', 'large', 'extraLarge', 'senior']) fontScale?: 'small' | 'default' | 'large' | 'extraLarge' | 'senior';
  @IsOptional() @IsBoolean() reducedMotion?: boolean;
  @IsOptional() @IsBoolean() seniorMode?: boolean;
  @IsOptional() @IsBoolean() hapticsEnabled?: boolean;
  @IsOptional() @IsBoolean() onboardingCompleted?: boolean;
}
