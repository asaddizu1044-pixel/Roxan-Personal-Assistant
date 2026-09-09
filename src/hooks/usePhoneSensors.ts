import { useCallback, useEffect, useRef, useState } from "react";

type SensorState = "idle" | "requesting" | "active" | "unsupported" | "denied" | "error";
type ActivityKind = "stationary" | "walking" | "running" | "cycling" | "exercise";
type Coordinates = { latitude: number; longitude: number; accuracy: number };

type SensorSnapshot = {
  steps: number;
  distanceMeters: number;
  speedKmh: number;
  calories: number;
  activity: ActivityKind;
  coordinates: Coordinates | null;
  route: Coordinates[];
  state: SensorState;
  permissionError: string | null;
};

// ✅ FIX 1: More sensitive thresholds
const STEP_THRESHOLD = 0.8;           // Pehle: 1.25
const STEP_COOLDOWN_MS = 200;         // Pehle: 280
const STEP_THRESHOLD_COUNT = 10;
const DEFAULT_STRIDE_METERS = 0.74;

export function usePhoneSensors() {
  const [snapshot, setSnapshot] = useState<SensorSnapshot>({
    steps: 0,
    distanceMeters: 0,
    speedKmh: 0,
    calories: 0,
    activity: "stationary",
    coordinates: null,
    route: [],
    state: "idle",
    permissionError: null,
  });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const lastStepAt = useRef(0);
  const lastCoordinates = useRef<Coordinates | null>(null);
  const lastLocationAt = useRef<number | null>(null);
  const lastSpeed = useRef(0);
  const stepCount = useRef(0);
  const gpsDistance = useRef(0);
  const motionSamples = useRef<number[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const pendingSteps = useRef(0);
  const thresholdMet = useRef(false);
  const lastStepTime = useRef(0);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const stop = useCallback(() => {
    setStartedAt(null);
    setSnapshot((current) => ({ ...current, state: "idle", speedKmh: 0, activity: "stationary" }));
    pendingSteps.current = 0;
    thresholdMet.current = false;
    stepCount.current = 0;
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setSnapshot((current) => ({
        ...current,
        state: "unsupported",
        permissionError: "This browser does not support GPS.",
      }));
      return false;
    }

    setSnapshot((current) => ({ ...current, state: "requesting", permissionError: null }));

    try {
      try {
        const motion = window.DeviceMotionEvent as typeof DeviceMotionEvent & {
          requestPermission?: () => Promise<string>
        };
        if (motion.requestPermission) {
          const permission = await motion.requestPermission();
          if (permission !== "granted") {
            throw new Error("Motion permission denied");
          }
        }
      } catch (motionError) {
        // Motion permission not supported - continue
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          (error) => reject(new Error(error.message)),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });

      stepCount.current = 0;
      gpsDistance.current = 0;
      pendingSteps.current = 0;
      thresholdMet.current = false;
      lastStepTime.current = 0;
      lastCoordinates.current = null;
      lastLocationAt.current = null;
      motionSamples.current = [];
      lastSpeed.current = 0;
      lastStepAt.current = 0;

      const initialCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      lastCoordinates.current = initialCoords;

      setSnapshot((current) => ({
        ...current,
        steps: 0,
        distanceMeters: 0,
        speedKmh: 0,
        calories: 0,
        activity: "stationary",
        coordinates: initialCoords,
        route: [initialCoords],
        state: "active",
        permissionError: null,
      }));

      setStartedAt(Date.now());

      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = navigator.geolocation.watchPosition(
        onPosition,
        onGpsError,
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
      );

      window.addEventListener("devicemotion", onMotion);

      return true;
    } catch (error) {
      setSnapshot((current) => ({
        ...current,
        state: "denied",
        permissionError: error instanceof Error ? error.message : "Permission not granted.",
      }));
      return false;
    }
  }, []);

  // ✅ Motion handler with 10-step threshold
  const onMotion = useCallback((event: DeviceMotionEvent) => {
    const acceleration = event.accelerationIncludingGravity;
    if (!acceleration) return;

    const magnitude = Math.sqrt(
      (acceleration.x ?? 0) ** 2 +
      (acceleration.y ?? 0) ** 2 +
      (acceleration.z ?? 0) ** 2
    );
    const dynamicMagnitude = Math.abs(magnitude - 9.81);
    motionSamples.current = [...motionSamples.current.slice(-19), dynamicMagnitude];

    const now = Date.now();

    if (now - lastStepTime.current > 5000 && lastStepTime.current > 0) {
      pendingSteps.current = 0;
      thresholdMet.current = false;
    }

    if (dynamicMagnitude > STEP_THRESHOLD && now - lastStepAt.current > STEP_COOLDOWN_MS) {
      lastStepAt.current = now;
      lastStepTime.current = now;

      if (!thresholdMet.current) {
        pendingSteps.current += 1;
        if (pendingSteps.current >= STEP_THRESHOLD_COUNT) {
          thresholdMet.current = true;
          stepCount.current = pendingSteps.current;
          pendingSteps.current = 0;
        }
      } else {
        stepCount.current += 1;
      }

      const averageMotion = motionSamples.current.reduce((sum, val) => sum + val, 0) / motionSamples.current.length;
      const nextActivity = classifyActivity(averageMotion, dynamicMagnitude, lastSpeed.current);
      const minutes = Math.max(0.1, (now - (startedAt || now)) / 60000);

      // ✅ FIX 2: Calories with BMR
      const caloriesBurned = estimateCalories(
        nextActivity,
        minutes,
        70,    // weight (kg)
        30,    // age (years)
        "male" // gender
      );

      setSnapshot((current) => ({
        ...current,
        steps: stepCount.current,
        distanceMeters: Math.max(gpsDistance.current, strideDistanceMeters(stepCount.current, DEFAULT_STRIDE_METERS)),
        calories: caloriesBurned,
        activity: nextActivity,
      }));
    }
  }, [startedAt]);

  // GPS position handler
  const onPosition = useCallback((position: GeolocationPosition) => {
    const next = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
    const now = Date.now();
    const previous = lastCoordinates.current;
    const previousAt = lastLocationAt.current;
    const delta = previous ? haversineMeters(previous, next) : 0;
    const seconds = previousAt ? Math.max(1, (now - previousAt) / 1000) : 0;
    const speedKmh = seconds ? (delta / seconds) * 3.6 : 0;

    gpsDistance.current += delta;
    lastSpeed.current = speedKmh;
    lastCoordinates.current = next;
    lastLocationAt.current = now;

    setSnapshot((current) => ({
      ...current,
      coordinates: next,
      route: [...current.route.slice(-399), next],
      distanceMeters: Math.max(gpsDistance.current, strideDistanceMeters(current.steps, DEFAULT_STRIDE_METERS)),
      speedKmh: speedKmh,
    }));
  }, []);

  const onGpsError = useCallback((error: GeolocationPositionError) => {
    setSnapshot((current) => ({
      ...current,
      state: "error",
      permissionError: "GPS unavailable. Using step fallback.",
    }));
  }, []);

  function classifyActivity(avgMotion: number, peak: number, speed: number): ActivityKind {
 
  if (avgMotion < 0.3 && peak < 0.6) return "stationary";
 
  if (speed < 2.0) return "stationary";
 
  if (speed >= 2.0 && speed < 8.0) return "walking";
  

  if (speed >= 8.0 && speed < 12.0) return "running";
  
  if (speed >= 12.0) return "cycling";
  
 
  if (avgMotion >= 1.5 || peak >= 2.5) return "running";
  if (avgMotion >= 0.3 && avgMotion < 1.5 && peak < 2.0) return "walking";
  
  return "exercise";
}
  function strideDistanceMeters(steps: number, stride: number) {
    return Math.max(0, steps) * stride;
  }

  // ✅ FIX 4: BMR-based calories formula
  function estimateCalories(
    activity: ActivityKind,
    minutes: number,
    weight: number = 70,
    age: number = 30,
    gender: "male" | "female" = "male"
  ) {
    const MET: Record<ActivityKind, number> = {
      stationary: 1.3,
      walking: 3.5,
      running: 8.3,
      cycling: 7.5,
      exercise: 5.5,
    };

    // BMR Calculation (Mifflin-St Jeor)
    let bmr: number;
    const height = gender === "male" ? 170 : 160;

    if (gender === "male") {
      bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }

    // Activity Calories = (MET × BMR × minutes) / 1440
    const activityCalories = (MET[activity] * bmr * minutes) / 1440;

    return Math.round(activityCalories);
  }

  function haversineMeters(from: Coordinates, to: Coordinates) {
    const R = 6371000;
    const lat1 = (from.latitude * Math.PI) / 180;
    const lat2 = (to.latitude * Math.PI) / 180;
    const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
    const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  return { ...snapshot, startedAt, start, stop, isOnline };
}