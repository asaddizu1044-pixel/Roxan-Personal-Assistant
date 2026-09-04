import type { ActivityKind } from "@/calculations/calories";

export type RoutePoint = { latitude: number; longitude: number; accuracy: number };

export function appendRoutePoint(route: RoutePoint[], point: RoutePoint, maxPoints = 400) {
  return [...route.slice(-(maxPoints - 1)), point];
}

export function classifyActivityFromSignals(accelerometerAverage: number, peakMagnitude: number, gpsSpeedKmh: number): ActivityKind {
  // Motion pattern is authoritative; GPS refines the distinction between locomotion modes.
  if (accelerometerAverage < 0.35 && peakMagnitude < 0.8) return "stationary";
  if (accelerometerAverage >= 3.0 || peakMagnitude >= 4.4) return gpsSpeedKmh > 12 ? "cycling" : "running";
  if (accelerometerAverage >= 1.55 || peakMagnitude >= 2.4) return gpsSpeedKmh > 12 ? "cycling" : "running";
  if (accelerometerAverage >= 0.7 || peakMagnitude >= 1.25) return "walking";
  return "exercise";
}