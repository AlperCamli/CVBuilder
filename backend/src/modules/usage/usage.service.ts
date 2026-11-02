import type { UsageCounterRecord } from "../../shared/types/domain";
import type { FreeTierMarkers, FreeTierUse, UsageRepository } from "./usage.repository";

export class UsageService {
  constructor(private readonly usageRepository: UsageRepository) {}

  async getCurrentMonth(userId: string): Promise<UsageCounterRecord> {
    return this.usageRepository.getOrCreateCurrentMonth(userId);
  }

  async incrementTailoredCvGeneration(userId: string): Promise<UsageCounterRecord> {
    return this.usageRepository.incrementCurrentMonth(userId, {
      tailored_cv_generations_increment: 1
    });
  }

  async incrementExport(userId: string, storageBytesDelta = 0): Promise<UsageCounterRecord> {
    return this.usageRepository.incrementCurrentMonth(userId, {
      exports_increment: 1,
      storage_bytes_delta: Math.max(storageBytesDelta, 0)
    });
  }

  async incrementAiAction(userId: string): Promise<UsageCounterRecord> {
    return this.usageRepository.incrementCurrentMonth(userId, {
      ai_actions_increment: 1
    });
  }

  async getFreeTierMarkers(userId: string): Promise<FreeTierMarkers> {
    return this.usageRepository.getFreeTierMarkers(userId);
  }

  async claimFreeTierUse(userId: string, use: FreeTierUse): Promise<string | null> {
    return this.usageRepository.claimFreeTierMarker(userId, use);
  }

  async releaseFreeTierUse(userId: string, use: FreeTierUse, claimedAt: string): Promise<void> {
    await this.usageRepository.releaseFreeTierMarker(userId, use, claimedAt);
  }
}
