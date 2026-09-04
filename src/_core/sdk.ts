import type { Request } from "express";
import type { User } from "../drizzle/schema";

export const sdk = {
  authenticateRequest: async (_req: Request): Promise<User | null> => {
    // In a real implementation, this would validate the session/token
    // For development, return a mock user
    return {
      id: 1,
      openId: "mock-user-123",
      name: "Alex Morgan",
      email: "alex@example.com",
      loginMethod: "mock",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as User;
  },
};