import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { hostname } from 'node:os';
import { CONFIG, type AppConfig } from '../config/configuration';
import { REPOSITORIES } from '../infrastructure/persistence/repository-tokens';
import type { PersonRepository, ScheduledJobRepository } from '../application/ports/repositories';
import { SYMBOLS } from '../application/ports/services';
import { Clock } from '../domain/shared/clock';
import { ScheduleGenerationService } from '../application/services/schedule.service';
import { EscalationEngine } from '../application/services/escalation.service';
import { TrustedContactUseCase } from '../application/use-cases/trusted-contact.use-case';

/**
 * العامل — دورة كل `SCHEDULER_TICK_SECONDS`:
 *  1) توليد مواعيد الأسابيع القادمة (آمن للتكرار)
 *  2) تقييم المواعيد المفتوحة (حان / لم يتم التحقق)
 *  3) تنفيذ طابور `scheduled_jobs` (تذكير / إعادة محاولة / تصعيد) بقفل `SKIP LOCKED`
 *  4) إنهاء الدعوات المنتهية وحذف أرقامها
 *
 * المؤقتات على الخادم — فالتذكير يصل في وقته حتى لو كان التطبيق مغلقًا.
 */
@Injectable()
export class SchedulerWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private readonly workerId = `${hostname()}:${process.pid}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickCount = 0;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(REPOSITORIES.persons) private readonly persons: PersonRepository,
    @Inject(REPOSITORIES.scheduledJobs) private readonly jobs: ScheduledJobRepository,
    @Inject(SYMBOLS.Clock) private readonly clock: Clock,
    private readonly schedule: ScheduleGenerationService,
    private readonly escalation: EscalationEngine,
    private readonly contacts: TrustedContactUseCase,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.scheduler.enabled || this.config.env === 'test') {
      this.logger.log('Scheduler disabled');
      return;
    }
    const interval = Math.max(5, this.config.scheduler.tickSeconds) * 1000;
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref?.();
    // أول دورة بعد ثوانٍ قليلة من الإقلاع
    setTimeout(() => void this.tick(), 3000).unref?.();
    this.logger.log(`Scheduler started (every ${interval / 1000}s, worker=${this.workerId})`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();
    try {
      this.tickCount += 1;
      // توليد المواعيد كل 10 دورات (أو في الأولى) — لا يحتاج كل 30 ثانية
      let generated = 0;
      if (this.tickCount === 1 || this.tickCount % 10 === 0) {
        const persons = await this.persons.listActive();
        for (const person of persons) {
          if (person.pausedUntil && person.pausedUntil.getTime() > this.clock.now().getTime()) continue;
          try {
            const result = await this.schedule.ensureEntriesForPerson(person, { enqueueReminders: true });
            generated += result.created;
          } catch (error) {
            this.logger.warn(`entry generation failed for person ${person.id}: ${(error as Error).message}`);
          }
        }
      }

      const evaluated = await this.escalation.evaluateOpenEntries(300);

      const due = await this.jobs.claimDue(this.clock.now(), 50, this.workerId);
      let processed = 0;
      for (const job of due) {
        try {
          if (job.kind === 'invite_expiry') {
            await this.contacts.expireStale();
          } else if (job.kind === 'entry_generation' || job.kind === 'report') {
            // تُعالَج ضمن الدورة نفسها
          } else {
            await this.escalation.processJob(job);
          }
          await this.jobs.markDone(job.id, this.clock.now());
          processed += 1;
        } catch (error) {
          const retryAt = job.attempts < 5 ? new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60_000) : null;
          await this.jobs.markFailed(job.id, (error as Error).message.slice(0, 500), retryAt);
          this.logger.warn(`job ${job.id} (${job.kind}) failed: ${(error as Error).message}`);
        }
      }

      const expired = this.tickCount % 20 === 0 ? await this.contacts.expireStale() : 0;

      if (generated || evaluated.changed || processed || expired) {
        this.logger.log(
          `tick#${this.tickCount} generated=${generated} evaluated=${evaluated.evaluated} changed=${evaluated.changed} jobs=${processed} expiredInvites=${expired} in ${Date.now() - startedAt}ms`,
        );
      }
    } catch (error) {
      this.logger.error(`tick failed: ${(error as Error).stack ?? (error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
