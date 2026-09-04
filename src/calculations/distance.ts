export type GeoPoint = { latitude: number; longitude: number };

export function haversineMeters(from: GeoPoint, to: GeoPoint) {
  const earthRadius = 6371000;
  const lat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const lon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a = Math.sin(lat / 2) ** 2 + Math.cos((from.latitude * Math.PI) / 180) * Math.cos((to.latitude * Math.PI) / 180) * Math.sin(lon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function strideDistanceMeters(steps: number, strideMeters = 0.74) {
  return Math.max(0, steps) * strideMeters;
}