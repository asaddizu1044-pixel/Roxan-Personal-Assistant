import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./context";

function createContext(user?: TrpcContext["user"]): TrpcContext {
  return {
    user: user || null,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => undefined } as any,
  };
}

describe("Smart Features activity procedures", () => {
  it("requires an authenticated session for history", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.activity.history({ from: 0, to: Date.now() })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects sync batches larger than the bounded request size", async () => {
    const caller = appRouter.createCaller(createContext({
      id: 1,
      openId: "test-user",
      name: "Test User",
      email: "test@example.com",
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    }));
    const records = Array.from({ length: 501 }, (_, index) => ({
      externalId: `record-${index}`,
      recordedAt: Date.now(),
      activityType: "walking" as const,
      steps: 10,
      distanceMeters: 8,
      activeSeconds: 60,
      calories: 5,
      avgHeartRate: 90,
      source: "watch" as const,
    }));
    await expect(caller.activity.sync({ source: "watch", deviceId: "test-watch", records })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});