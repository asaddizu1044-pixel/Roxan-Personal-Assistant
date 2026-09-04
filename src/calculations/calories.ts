export type ActivityKind = "stationary" | "walking" | "running" | "cycling" | "exercise";

const MET: Record<ActivityKind, number> = {
  stationary: 1.3,
  walking: 3.5,
  running: 8.3,
  cycling: 7.5,
  exercise: 5.5,
};

export function estimateActiveCalories(activity: ActivityKind, minutes: number, weightKg = 70) {
  return Math.round((MET[activity] * 3.5 * Math.max(1, weightKg) * Math.max(0, minutes)) / 200);
}