import { describe, expect, it, vi } from "vitest";
import { createDemoStore } from "./demo-data";
import type {
  JobBoardResponse,
  MasterCvDetail,
} from "../../integration/api-types";
import type { BillingPrices } from "../../integration/regional-pricing";
import { trialPlanCode } from "../../../content/pricing";

describe("isolated Language Studio data", () => {
  it("keeps document languages independent and returned data detached", async () => {
    const store = createDemoStore();
    const en = await store.client.get<MasterCvDetail>(
      "/master-cvs/demo-master-en",
    );
    const tr = await store.client.get<MasterCvDetail>(
      "/master-cvs/demo-master-tr",
    );
    expect(en.current_content.language).toBe("en");
    expect(tr.current_content.language).toBe("tr");
    expect(JSON.stringify(tr.current_content)).toContain("İşletme Lisansı");
    en.title = "Unsaved mutation";
    expect(
      (await store.client.get<MasterCvDetail>("/master-cvs/demo-master-en"))
        .title,
    ).not.toBe(en.title);
  });
  it("saves and deletes only inside one store and blocks remote actions", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const first = createDemoStore(),
      second = createDemoStore();
    await first.client.patch("/master-cvs/demo-master-en", {
      title: "Local title",
    });
    expect(
      (await first.client.get<MasterCvDetail>("/master-cvs/demo-master-en"))
        .title,
    ).toBe("Local title");
    expect(
      (await second.client.get<MasterCvDetail>("/master-cvs/demo-master-en"))
        .title,
    ).not.toBe("Local title");
    await first.client.delete("/master-cvs/demo-master-en");
    expect(await first.client.get<unknown[]>("/master-cvs")).toHaveLength(1);
    expect(await second.client.get<unknown[]>("/master-cvs")).toHaveLength(2);
    for (const path of [
      "/billing/checkout",
      "/billing/portal",
      "/imports/upload-url",
      "/master-cvs/demo-master-tr/exports/pdf",
      "/me/privacy/delete",
    ]) {
      await expect(first.client.post(path)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it("offers the demo free trial on Monthly, like the live catalog", async () => {
    for (const market of ["TR", "GLOBAL"] as const) {
      const prices = await createDemoStore("populated", "monthly", market).client.get<BillingPrices>("/billing/prices");
      expect(prices.plans.filter((plan) => plan.trial_days > 0).map((plan) => plan.code)).toEqual(["monthly"]);
      expect(trialPlanCode(prices)).toBe("monthly");
    }
  });
  it("changes sample job status and exposes empty, error and cancellable loading states", async () => {
    const populated = createDemoStore();
    await populated.client.patch("/jobs/demo-job-0/status", {
      status: "interview",
    });
    const board = await populated.client.get<JobBoardResponse>("/jobs/board");
    expect(board.counts_by_status.interview).toBe(2);
    expect(await createDemoStore("empty").client.get("/master-cvs")).toEqual(
      [],
    );
    await expect(
      createDemoStore("error").client.get("/dashboard"),
    ).rejects.toThrow();
    const abort = new AbortController();
    const loading = createDemoStore("loading").client.get("/dashboard", {
      signal: abort.signal,
    });
    abort.abort();
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  });
});
