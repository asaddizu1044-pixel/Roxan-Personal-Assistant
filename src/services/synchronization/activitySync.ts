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