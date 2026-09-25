import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ALL_RELATIONSHIPS, ALL_CHECK_IN_METHODS, LIMITS } from '@wesal/shared';
import type { AttemptOutcome, CheckInMethod, CheckInStatus, LocalTime, Relationship, Weekday, PauseReason } from '@wesal/shared';

export class ScheduleInputDto {
  @IsArray() weekdays!: Weekday[];
  @IsArray() times!: LocalTime[];
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() from?: string;
}

export class TrustedContactInputDto {
  @IsString() @Length(1, LIMITS.trustedContactNameMax) fullName!: string;
  @IsString() phone!: string;
  @IsOptional() relationship?: Relationship | null;
}

export class CreatePersonDto {
  @IsString() @Length(LIMITS.personNameMin, LIMITS.personNameMax) displayName!: string;
  @IsIn(ALL_RELATIONSHIPS as readonly string[]) relationship!: Relationship;
  @IsObject() schedule!: ScheduleInputDto;
  @IsOptional() phone?: string | null;
  @IsOptional() notes?: string | null;
  @IsOptional() photoUrl?: string | null;
  @IsOptional() @IsBoolean() isAppUser?: boolean;
  @IsOptional() @IsBoolean() seniorMode?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(24 * 60) gracePeriodMinutes?: number;
  @IsOptional() quietHours?: { start: LocalTime; end: LocalTime } | null;
  @IsOptional() trustedContact?: TrustedContactInputDto | null;
}

export class UpdatePersonDto {
  @IsOptional() @IsString() @Length(LIMITS.personNameMin, LIMITS.personNameMax) displayName?: string;
  @IsOptional() @IsIn(ALL_RELATIONSHIPS as readonly string[]) relationship?: Relationship;
  @IsOptional() phone?: string | null;
  @IsOptional() notes?: string | null;
  @IsOptional() photoUrl?: string | null;
  @IsOptional() @IsBoolean() seniorMode?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(24 * 60) gracePeriodMinutes?: number;
  @IsOptional() quietHours?: { start: LocalTime; end: LocalTime } | null;
  @IsOptional() @IsObject() schedule?: ScheduleInputDto;
}

export class PausePersonDto {
  @IsOptional() until?: string | null;
  @IsOptional() @IsString() reason?: PauseReason;
  @IsOptional() note?: string | null;
  @IsOptional() temporarySchedule?: ScheduleInputDto | null;
}

export class ReportDeceasedDto {
  @IsBoolean() confirm!: boolean;
  @IsOptional() note?: string | null;
}

export class ExceptionDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsIn(['move', 'skip', 'add']) action!: 'move' | 'skip' | 'add';
  @IsOptional() @IsArray() times?: LocalTime[];
  @IsOptional() note?: string | null;
}

export class RecordCheckInDto {
  @IsOptional() entryId?: string | null;
  @IsIn(ALL_CHECK_IN_METHODS as readonly string[]) method!: CheckInMethod;
  @IsOptional() @IsIn(['reassured', 'called_no_answer', 'snoozed']) status?: CheckInStatus;
  @IsOptional() @IsString() occurredAt?: string;
  @IsOptional() notes?: string | null;
  @IsString() @Length(8, 128) idempotencyKey!: string;
  @IsOptional() @IsBoolean() fromOfflineQueue?: boolean;
}

export class RecordAttemptDto {
  @IsOptional() entryId?: string | null;
  @IsIn(['no_answer', 'answered', 'busy', 'unreachable', 'will_retry']) outcome!: AttemptOutcome;
  @IsOptional() @IsInt() @Min(5) @Max(24 * 60) retryAfterMinutes?: number;
  @IsString() @Length(8, 128) idempotencyKey!: string;
  @IsOptional() @IsString() occurredAt?: string;
}

export class SnoozeDto {
  @IsOptional() entryId?: string | null;
  @IsOptional() @IsInt() @Min(5) @Max(24 * 60) minutes?: number;
  @IsOptional() @IsString() @Matches(/^\d{2}:\d{2}$/) untilLocalTime?: LocalTime;
  @IsString() @Length(8, 128) idempotencyKey!: string;
}

export class InviteContactDto extends TrustedContactInputDto {
  @IsOptional() personalNote?: string | null;
}

export class SyncDto {
  @IsArray() operations!: import('@wesal/shared').SyncOperation[];
  @IsOptional() @IsString() since?: string;
}

export class MarkReadDto {
  @IsOptional() @IsArray() ids?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
}
