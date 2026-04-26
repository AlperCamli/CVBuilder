import type { Logger } from "pino";
import type { AiRepository } from "./ai.repository";

export interface AiRunWatchdogOptions {
  staleAfterMs: number;
  sweepIntervalMs: number;
  logger?: Logger;
  now?: () => Date;
}

export interface AiRunWatchdog {
  stop(): void;
  sweepOnce(): Promise<number>;
}

export const startAiRunWatchdog = (
  repository: AiRepository,
  options: AiRunWatchdogOptions
): AiRunWatchdog => {
  const now = options.now ?? (() => new Date());

  const sweepOnce = async (): Promise<number> => {
    try {
      const cutoffIso = new Date(now().getTime() - options.staleAfterMs).toISOString();
      const failedCount = await repository.failStaleRuns(cutoffIso);
      if (failedCount > 0 && options.logger) {
        options.logger.warn(
          { failed_count: failedCount, cutoff: cutoffIso, stale_after_ms: options.staleAfterMs },
          "Failed stale AI runs"
        );
      }
      return failedCount;
    } catch (error) {
      if (options.logger) {
        options.logger.error({ err: error }, "AI run watchdog sweep failed");
      }
      return 0;
    }
  };

  const interval = setInterval(() => {
    void sweepOnce();
  }, options.sweepIntervalMs);
  // Don't keep the event loop alive solely for sweeping.
  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return {
    stop: () => clearInterval(interval),
    sweepOnce
  };
};
