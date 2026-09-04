export function segmentSpeedKmh(distanceMeters: number, seconds: number) {
  if (seconds === 0) return 0;
  return (distanceMeters / seconds) * 3.6;
}