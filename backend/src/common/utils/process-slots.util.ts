import {
  MEDIA_PROCESS_SLOTS,
  MEDIA_SLOT_WAIT_MS,
} from '@/common/constants/media-limits.constant';

/**
 * A process-wide counting semaphore: at most `size` tasks run at once, and a
 * task that can't start within `waitMs` is rejected instead of queueing
 * forever.
 */
export class ProcessSlots {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly size: number,
    private readonly waitMs: number,
  ) {}

  /** Run `task` in a slot, releasing it however the task settles. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.size) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(grant);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(new Error(`No free media slot after ${this.waitMs} ms`));
      }, this.waitMs);
      this.waiting.push(grant);
    });
  }

  /** Hand the slot straight to the next waiter, or free it. */
  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }
}

/** The slots every ffprobe/ffmpeg run on an uploaded file goes through. */
export const mediaProcessSlots = new ProcessSlots(
  MEDIA_PROCESS_SLOTS,
  MEDIA_SLOT_WAIT_MS,
);
