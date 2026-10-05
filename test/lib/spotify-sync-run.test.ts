import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PinsReplaced } from "../../src/audio/pins";
import type { MatchRunResult } from "../../src/lib/spotify/match-library";

// sync.ts is server code; its guard only resolves under Next's server build.
vi.mock("server-only", () => ({}));

// Every collaborator is a stub, so what is tested is the run's own wiring:
// the order of its stages, the time budget, and what a failure does.
const stub = vi.hoisted(() => ({
  activeConnections: vi.fn(),
  claimSyncLease: vi.fn(),
  releaseSyncLease: vi.fn(),
  freshAccessToken: vi.fn(),
  markAttempt: vi.fn(),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
  saveDailyPass: vi.fn(),
  saveListenCursor: vi.fn(),
  syncUser: vi.fn(),
  matchLibrary: vi.fn(),
  supabaseMatchStore: vi.fn(),
  sendKeepList: vi.fn(),
  supabaseKeepListStore: vi.fn(),
  createImportService: vi.fn(),
  createPinService: vi.fn(),
  mp3serverServiceConfig: vi.fn(),
}));

vi.mock("../../src/lib/spotify/connection", () => ({
  activeConnections: stub.activeConnections,
  claimSyncLease: stub.claimSyncLease,
  releaseSyncLease: stub.releaseSyncLease,
  freshAccessToken: stub.freshAccessToken,
  markAttempt: stub.markAttempt,
  recordFailure: stub.recordFailure,
  recordSuccess: stub.recordSuccess,
  saveDailyPass: stub.saveDailyPass,
  saveListenCursor: stub.saveListenCursor,
}));
vi.mock("../../src/lib/spotify/sync-user", () => ({ syncUser: stub.syncUser }));
vi.mock("../../src/lib/spotify/match-library", () => ({ matchLibrary: stub.matchLibrary }));
vi.mock("../../src/lib/spotify/match-store", () => ({ supabaseMatchStore: stub.supabaseMatchStore }));
vi.mock("../../src/lib/spotify/keep-list", () => ({ sendKeepList: stub.sendKeepList }));
vi.mock("../../src/lib/spotify/keep-list-store", () => ({ supabaseKeepListStore: stub.supabaseKeepListStore }));
vi.mock("../../src/audio/imports", () => ({ createImportService: stub.createImportService }));
vi.mock("../../src/audio/pins", () => ({ createPinService: stub.createPinService }));
vi.mock("../../src/lib/spotify/config", () => ({ mp3serverServiceConfig: stub.mp3serverServiceConfig }));

import { syncAllUsers } from "../../src/lib/spotify/sync";

const RUN_BUDGET_MS = 200_000;

const matchResult: MatchRunResult = { requeued: 1, collected: 2, collectErrors: 0, submitted: 3, unsendable: 0 };
const pinsResult: PinsReplaced = { count: 10, added: 2, removed: 1 };
const config = { baseUrl: "https://mp3server.test", serviceToken: "token" };
const matchStore = { store: "match" };
const keepListStore = { store: "keep list" };
const importService = { service: "imports" };
const pinService = { service: "pins" };

/** The order the stages ran in, and the clock the run reads. */
let order: string[];
let clock: number;

function stage<T>(name: string, result: T) {
  return async () => {
    order.push(name);
    return result;
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  order = [];
  clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);

  stub.claimSyncLease.mockImplementation(stage("claim", "holder-1"));
  stub.activeConnections.mockImplementation(stage("connections", []));
  stub.matchLibrary.mockImplementation(stage("match", matchResult));
  stub.sendKeepList.mockImplementation(stage("keep", pinsResult));
  stub.releaseSyncLease.mockImplementation(stage("release", undefined));
  stub.mp3serverServiceConfig.mockReturnValue(config);
  stub.supabaseMatchStore.mockReturnValue(matchStore);
  stub.supabaseKeepListStore.mockReturnValue(keepListStore);
  stub.createImportService.mockReturnValue(importService);
  stub.createPinService.mockReturnValue(pinService);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncAllUsers", () => {
  it("matches, then sends the keep list, then releases the lease, and returns both results", async () => {
    const result = await syncAllUsers();

    expect(order).toEqual(["claim", "connections", "match", "keep", "release"]);
    expect(result).toEqual({
      status: "done",
      synced: 0,
      failed: 0,
      skipped: 0,
      rateLimited: false,
      matching: matchResult,
      pins: pinsResult,
    });
    expect(stub.activeConnections).toHaveBeenCalledWith();
    expect(stub.releaseSyncLease).toHaveBeenCalledWith("holder-1");
    expect(stub.createImportService).toHaveBeenCalledWith(config);
    expect(stub.createPinService).toHaveBeenCalledWith(config);
    expect(stub.matchLibrary).toHaveBeenCalledWith(matchStore, importService, expect.any(Date));
    expect(stub.sendKeepList).toHaveBeenCalledWith(keepListStore, pinService);
  });

  it("still sends the keep list when matching fails, and logs the failure", async () => {
    const down = new Error("mp3server is down");
    stub.matchLibrary.mockImplementation(async () => {
      order.push("match");
      throw down;
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncAllUsers();

    expect(order).toEqual(["claim", "connections", "match", "keep", "release"]);
    expect(result).toMatchObject({ status: "done", matching: null, pins: pinsResult });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("Library matching failed"), down);
  });

  it("logs a keep-list failure and still finishes the run and releases the lease", async () => {
    const refused = new Error("mp3server refused the keep list");
    stub.sendKeepList.mockImplementation(async () => {
      order.push("keep");
      throw refused;
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncAllUsers();

    expect(order).toEqual(["claim", "connections", "match", "keep", "release"]);
    expect(result).toMatchObject({ status: "done", matching: matchResult, pins: null });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("keep list"), refused);
    expect(stub.releaseSyncLease).toHaveBeenCalledWith("holder-1");
  });

  it("is busy, and matches nothing, when another run holds the lease", async () => {
    stub.claimSyncLease.mockImplementation(stage("claim", null));

    const result = await syncAllUsers();

    expect(result).toEqual({ status: "busy" });
    expect(order).toEqual(["claim"]);
    expect(stub.matchLibrary).not.toHaveBeenCalled();
    expect(stub.sendKeepList).not.toHaveBeenCalled();
    expect(stub.releaseSyncLease).not.toHaveBeenCalled();
  });

  it("skips matching and the keep list, and says so, once the run is out of time", async () => {
    stub.activeConnections.mockImplementation(async () => {
      order.push("connections");
      clock += RUN_BUDGET_MS;
      return [];
    });
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await syncAllUsers();

    expect(order).toEqual(["claim", "connections", "release"]);
    expect(result).toMatchObject({ status: "done", matching: null, pins: null });
    expect(warned).toHaveBeenCalledTimes(2);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining("skipped library matching"));
    expect(warned).toHaveBeenCalledWith(expect.stringContaining("skipped the keep list"));
  });

  it("runs both while it is still one millisecond inside the budget", async () => {
    stub.activeConnections.mockImplementation(async () => {
      order.push("connections");
      clock += RUN_BUDGET_MS - 1;
      return [];
    });

    const result = await syncAllUsers();

    expect(order).toEqual(["claim", "connections", "match", "keep", "release"]);
    expect(result).toMatchObject({ status: "done", matching: matchResult, pins: pinsResult });
  });

  it("skips just the keep list when matching uses up the budget", async () => {
    stub.matchLibrary.mockImplementation(async () => {
      order.push("match");
      clock += RUN_BUDGET_MS;
      return matchResult;
    });
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await syncAllUsers();

    expect(order).toEqual(["claim", "connections", "match", "release"]);
    expect(result).toMatchObject({ status: "done", matching: matchResult, pins: null });
    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining("skipped the keep list"));
  });

  it("releases the lease and fails the run when the users can't be read", async () => {
    const broken = new Error("read Spotify connections: boom");
    stub.activeConnections.mockImplementation(async () => {
      order.push("connections");
      throw broken;
    });

    await expect(syncAllUsers()).rejects.toThrow(broken);

    expect(order).toEqual(["claim", "connections", "release"]);
    expect(stub.matchLibrary).not.toHaveBeenCalled();
    expect(stub.sendKeepList).not.toHaveBeenCalled();
  });
});
