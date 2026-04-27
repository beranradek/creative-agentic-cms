import type { ImageGenJob, JobStatus, TempImage } from "./types.js";

const JOB_RETENTION_MS = 5 * 60 * 1000;
const TEMP_IMAGE_TTL_MS = 20 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export class JobManager {
  private readonly jobs = new Map<string, ImageGenJob>();
  private readonly tempImages = new Map<string, TempImage>();
  private readonly rateLimitMap = new Map<string, number[]>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const cutoff = Date.now() - JOB_RETENTION_MS;
      for (const [id, job] of this.jobs) {
        if (job.createdAt < cutoff) {
          this.jobs.delete(id);
        }
      }
    }, JOB_RETENTION_MS);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  stopCleanup(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  createJob(): ImageGenJob {
    const job: ImageGenJob = {
      id: crypto.randomUUID(),
      status: "processing",
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  updateJob(id: string, patch: Partial<Pick<ImageGenJob, "status" | "tempImageId" | "error">>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, { ...job, ...patch } as ImageGenJob);
  }

  getJob(id: string): ImageGenJob | undefined {
    return this.jobs.get(id);
  }

  storeTempImage(id: string, img: TempImage): void {
    this.tempImages.set(id, img);
    const timer = setTimeout(() => {
      this.tempImages.delete(id);
    }, TEMP_IMAGE_TTL_MS);
    if (timer.unref) timer.unref();
  }

  getTempImage(id: string): TempImage | undefined {
    return this.tempImages.get(id);
  }

  deleteTempImage(id: string): void {
    this.tempImages.delete(id);
  }

  checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    const timestamps = (this.rateLimitMap.get(ip) ?? []).filter((t) => t > cutoff);
    if (timestamps.length >= RATE_LIMIT_MAX) {
      this.rateLimitMap.set(ip, timestamps);
      return false;
    }
    timestamps.push(now);
    this.rateLimitMap.set(ip, timestamps);
    return true;
  }
}
