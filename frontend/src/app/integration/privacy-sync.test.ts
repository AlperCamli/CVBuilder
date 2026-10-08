import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
const state = vi.hoisted(() => ({session: null as unknown, guest: null as unknown, updateGuest: vi.fn()}));
vi.mock("./supabase-client", () => ({supabase: {auth: {getSession: async () => ({data: {session: state.session}})}}}));
vi.mock("./guest-import", () => ({readGuestUpload: () => state.guest, updateGuestPrivacy: state.updateGuest}));
import {saveAnalyticsChoice, syncBrowserChoice} from "./privacy";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  state.session = null; state.guest = null; state.updateGuest.mockReset();
  const data = new Map<string,string>();
  vi.stubGlobal("localStorage", {getItem: (key: string) => data.get(key) ?? null, setItem: (key: string,value: string) => data.set(key,value)});
  vi.stubGlobal("window", {location: {origin: "https://cv.example"}, dispatchEvent: vi.fn()});
  vi.stubGlobal("navigator", {globalPrivacyControl: false});
  fetchMock = vi.fn(async () => new Response(JSON.stringify({success: true, data: {analytics: true}}), {headers: {"content-type": "application/json"}}));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
describe("browser consent database association", () => {
  it("associates an existing browser choice after account creation without reading or changing AI permission", async () => {
    saveAnalyticsChoice(true, {notify: false}); state.session = {access_token: "fixture"};
    await syncBrowserChoice();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0] as unknown as [string,RequestInit];
    expect(request[1].method).toBe("PATCH"); expect(request[1].keepalive).toBe(true);
    expect(JSON.parse(request[1].body as string)).toEqual({analytics: true, notice_version: "2026-10-06.2"});
  });
  it("updates guest analytics independently of the active AI grant", async () => {
    saveAnalyticsChoice(true, {notify: false}); state.guest = {id: "fixture-guest"};
    await syncBrowserChoice();
    expect(state.updateGuest).toHaveBeenCalledWith(state.guest, {analytics: true, notice_version: "2026-10-06.2"});
  });
  it("does not manufacture an acceptance for a browser with no choice", async () => {
    state.session = {access_token: "fixture"}; await syncBrowserChoice(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("persists GPC as rejection even if a prior choice was positive", async () => {
    saveAnalyticsChoice(true, {notify: false}); state.session = {access_token: "fixture"}; vi.stubGlobal("navigator", {globalPrivacyControl: true});
    await syncBrowserChoice();
    const request = fetchMock.mock.calls[0] as unknown as [string,RequestInit];
    expect(JSON.parse(request[1].body as string).analytics).toBe(false);
  });
});
