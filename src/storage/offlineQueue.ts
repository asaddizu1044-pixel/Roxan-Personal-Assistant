export type QueuedSensorSession = {
  externalId: string;
  recordedAt: number;
  activityType: "stationary" | "walking" | "running" | "cycling" | "exercise";
  steps: number;
  distanceMeters: number;
  activeSeconds: number;
  calories: number;
  avgHeartRate: null;
  route?: Array<{ latitude: number; longitude: number; accuracy: number }>;
};

const STORAGE_KEY = "real-personal-tracker:offline-sessions";

export function readQueuedSessions(): QueuedSensorSession[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as QueuedSensorSession[]; } catch { return []; }
}

export function queueSensorSession(session: QueuedSensorSession) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...readQueuedSessions(), session].slice(-100)));
}

export function clearQueuedSessions() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}