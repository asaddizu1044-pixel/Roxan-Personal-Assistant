import type { ActivityKind } from "@/calculations/calories";

export type SyncableActivity = {
  externalId: string;
  recordedAt: number;
  activityType: ActivityKind;
  steps: number;
  distanceMeters: number;
  activeSeconds: number;
  calories: number;
  avgHeartRate: number | null;
  route?: Array<{ latitude: number; longitude: number; accuracy: number }>;
};

export type ActivitySyncPayload = {
  source: "phone" | "watch" | "wearable";
  deviceId: string;
  cursor?: string | null;
  records: SyncableActivity[];
};

export function buildPhoneSyncPayload(record: SyncableActivity): ActivitySyncPayload {
  return { source: "phone", deviceId: "browser-phone", cursor: String(record.recordedAt), records: [record] };
}

const STORAGE_KEY = "roxan-queued-sessions";

export function readQueuedSessions(): SyncableActivity[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SyncableActivity[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function queueSensorSession(session: SyncableActivity) {
  const queued = readQueuedSessions();
  queued.push(session);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queued));
}

export function removeQueuedSession(externalId: string) {
  const queued = readQueuedSessions();
  const filtered = queued.filter((s) => s.externalId !== externalId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export async function flushQueuedSessions(): Promise<{
  ok: number;
  failed: number;
}> {
  const queued = readQueuedSessions();
  if (queued.length === 0) {
    return { ok: 0, failed: 0 };
  }

  let ok = 0;
  let failed = 0;

  for (const session of queued) {
    const payload = buildPhoneSyncPayload(session);

    try {
      const res = await fetch("/api/activity/sync", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        failed++;
        continue;
      }

      const body = (await res.json()) as {
        accepted: number;
        lastSyncedAt: number;
      };

      if (body.accepted > 0) {
        removeQueuedSession(session.externalId);
        ok++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { ok, failed };
}