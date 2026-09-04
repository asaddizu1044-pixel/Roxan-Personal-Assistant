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

const STEP_THRESHOLD = 1.25;
const STEP_COOLDOWN_MS = 280;
const STEP_THRESHOLD_COUNT = 10; // ✅ Smartwatch 10-step rule
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
  
  // ✅ Threshold tracking refs
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
    
    // Reset threshold
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
      // Motion permission (Safari only)
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

      // GPS permission
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          (error) => reject(new Error(error.message)),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });

      // Reset state
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
    
    // ✅ Reset threshold if user stopped for more than 5 seconds
    if (now - lastStepTime.current > 5000 && lastStepTime.current > 0) {
      pendingSteps.current = 0;
      thresholdMet.current = false;
    }
    
    if (dynamicMagnitude > STEP_THRESHOLD && now - lastStepAt.current > STEP_COOLDOWN_MS) {
      lastStepAt.current = now;
      lastStepTime.current = now;
      
      // ✅ Smartwatch 10-step threshold logic
      if (!thresholdMet.current) {
        pendingSteps.current += 1;
        
        if (pendingSteps.current >= STEP_THRESHOLD_COUNT) {
          // ✅ Threshold met! Show all pending steps
          thresholdMet.current = true;
          stepCount.current = pendingSteps.current;
          pendingSteps.current = 0;
        }
      } else {
        // ✅ Threshold already met - count normally
        stepCount.current += 1;
      }
      
      const averageMotion = motionSamples.current.reduce((sum, val) => sum + val, 0) / motionSamples.current.length;
      const nextActivity = classifyActivity(averageMotion, dynamicMagnitude, lastSpeed.current);
      const minutes = Math.max(0.1, (now - (startedAt || now)) / 60000);
      
      setSnapshot((current) => ({
        ...current,
        steps: stepCount.current,
        distanceMeters: Math.max(gpsDistance.current, strideDistanceMeters(stepCount.current, DEFAULT_STRIDE_METERS)),
        calories: estimateCalories(nextActivity, minutes),
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

  // Helper functions
  function classifyActivity(avgMotion: number, peak: number, speed: number): ActivityKind {
    if (avgMotion < 0.35 && peak < 0.8) return "stationary";
    if (avgMotion >= 3.0 || peak >= 4.4) return speed > 12 ? "cycling" : "running";
    if (avgMotion >= 1.55 || peak >= 2.4) return speed > 12 ? "cycling" : "running";
    if (avgMotion >= 0.7 || peak >= 1.25) return "walking";
    return "exercise";
  }

  function strideDistanceMeters(steps: number, stride: number) {
    return Math.max(0, steps) * stride;
  }

  function estimateCalories(activity: ActivityKind, minutes: number) {
    const MET: Record<ActivityKind, number> = {
      stationary: 1.3,
      walking: 3.5,
      running: 8.3,
      cycling: 7.5,
      exercise: 5.5,
    };
    return Math.round((MET[activity] * 3.5 * 70 * minutes) / 200);
  }

  function haversineMeters(from: Coordinates, to: Coordinates) {
    const R = 6371000;
    const lat1 = (from.latitude * Math.PI) / 180;
    const lat2 = (to.latitude * Math.PI) / 180;
    const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
    const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
    const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  return { ...snapshot, startedAt, start, stop, isOnline };
}