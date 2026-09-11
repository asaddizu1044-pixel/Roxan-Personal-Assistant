import { useCallback, useEffect, useRef, useState } from "react";

type SensorState =
  | "idle"
  | "requesting"
  | "active"
  | "unsupported"
  | "denied"
  | "error";

type ActivityKind =
  | "stationary"
  | "walking"
  | "running"
  | "cycling"
  | "exercise";

type Coordinates = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

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

  // Debug / sensor information
  accelerationMagnitude: number;
  motionAverage: number;
  motionPeak: number;
};

const STEP_THRESHOLD = 0.8;
const STEP_COOLDOWN_MS = 300;
const DEFAULT_STRIDE_METERS = 0.74;

const GPS_MAX_ACCURACY_METERS = 50;
const GPS_MAX_REASONABLE_SPEED_KMH = 35;

const WALKING_MIN_SPEED_KMH = 1.5;
const WALKING_MAX_SPEED_KMH = 8;
const RUNNING_MIN_SPEED_KMH = 8;
const CYCLING_MIN_SPEED_KMH = 12;

const CLASSIFICATION_INTERVAL_MS = 250;
const ACTIVITY_CONFIRMATION_COUNT = 2;

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
    accelerationMagnitude: 0,
    motionAverage: 0,
    motionPeak: 0,
  });

  const [startedAt, setStartedAt] = useState<number | null>(null);

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const startedAtRef = useRef<number | null>(null);

  const lastStepAt = useRef(0);
  const lastMotionValue = useRef(0);
  const lastCoordinates = useRef<Coordinates | null>(null);
  const lastLocationAt = useRef<number | null>(null);

  const lastSpeed = useRef(0);
  const smoothedSpeed = useRef(0);

  const stepCount = useRef(0);
  const gpsDistance = useRef(0);

  const motionSamples = useRef<number[]>([]);
  const gpsSpeedSamples = useRef<number[]>([]);

  const watchIdRef = useRef<number | null>(null);

  const lastClassificationAt = useRef(0);

  const stableActivity = useRef<ActivityKind>("stationary");
  const candidateActivity = useRef<ActivityKind>("stationary");
  const candidateCount = useRef(0);

  const motionAvailable = useRef(false);

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

  const estimateCalories = useCallback(
    (
      activity: ActivityKind,
      minutes: number,
      weight: number = 70,
      age: number = 30,
      gender: "male" | "female" = "male",
    ) => {
      const MET: Record<ActivityKind, number> = {
        stationary: 1.3,
        walking: 3.5,
        running: 8.3,
        cycling: 7.5,
        exercise: 5.5,
      };

      const height = gender === "male" ? 170 : 160;

      let bmr: number;

      if (gender === "male") {
        bmr = 10 * weight + 6.25 * height - 5 * age + 5;
      } else {
        bmr = 10 * weight + 6.25 * height - 5 * age - 161;
      }

      const activityCalories =
        (MET[activity] * bmr * Math.max(0, minutes)) / 1440;

      return Math.max(0, Math.round(activityCalories));
    },
    [],
  );

  const haversineMeters = useCallback(
    (from: Coordinates, to: Coordinates) => {
      const R = 6371000;

      const lat1 = (from.latitude * Math.PI) / 180;
      const lat2 = (to.latitude * Math.PI) / 180;

      const dLat =
        ((to.latitude - from.latitude) * Math.PI) / 180;

      const dLon =
        ((to.longitude - from.longitude) * Math.PI) / 180;

      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) *
          Math.cos(lat2) *
          Math.sin(dLon / 2) ** 2;

      return (
        R *
        2 *
        Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      );
    },
    [],
  );

  const stabilizeActivity = useCallback(
    (nextActivity: ActivityKind): ActivityKind => {
      if (nextActivity === stableActivity.current) {
        candidateActivity.current = nextActivity;
        candidateCount.current = 0;
        return stableActivity.current;
      }

      if (candidateActivity.current !== nextActivity) {
        candidateActivity.current = nextActivity;
        candidateCount.current = 1;

        return stableActivity.current;
      }

      candidateCount.current += 1;

      if (candidateCount.current >= ACTIVITY_CONFIRMATION_COUNT) {
        stableActivity.current = nextActivity;
        candidateCount.current = 0;
      }

      return stableActivity.current;
    },
    [],
  );

  const classifyActivity = useCallback(
    (
      avgMotion: number,
      peakMotion: number,
      speed: number,
      hasGps: boolean,
    ): ActivityKind => {
      const safeSpeed =
        Number.isFinite(speed) && speed >= 0
          ? speed
          : 0;

      /*
       * GPS is strong evidence of movement, but we don't trust
       * one extremely large/noisy GPS value.
       */

      if (hasGps && safeSpeed >= CYCLING_MIN_SPEED_KMH) {
        return "cycling";
      }

      if (
        hasGps &&
        safeSpeed >= RUNNING_MIN_SPEED_KMH &&
        safeSpeed < CYCLING_MIN_SPEED_KMH
      ) {
        return "running";
      }

      if (
        hasGps &&
        safeSpeed >= WALKING_MIN_SPEED_KMH &&
        safeSpeed < WALKING_MAX_SPEED_KMH
      ) {
        return "walking";
      }

      /*
       * Accelerometer fallback.
       *
       * This is intentionally less aggressive than the old
       * classifier. Motion does not need to cross a very high
       * threshold before the activity changes.
       */

      if (avgMotion >= 1.8 || peakMotion >= 2.8) {
        return "running";
      }

      if (avgMotion >= 0.3 || peakMotion >= 0.7) {
        return "walking";
      }

      /*
       * Slow walking can sometimes have GPS speed below 1.5 km/h.
       * If there is measurable motion, don't immediately call it
       * stationary.
       */

      if (
        hasGps &&
        safeSpeed >= 0.7 &&
        (avgMotion >= 0.15 || peakMotion >= 0.45)
      ) {
        return "walking";
      }

      /*
       * Only use stationary when BOTH GPS and motion indicate
       * very little activity.
       */

      if (
        safeSpeed < 0.7 &&
        avgMotion < 0.25 &&
        peakMotion < 0.5
      ) {
        return "stationary";
      }

      return "exercise";
    },
    [],
  );

  const updateActivity = useCallback(
    (
      speed: number,
      hasGps: boolean,
      accelerationMagnitude: number,
      motionAverage: number,
      motionPeak: number,
    ) => {
      const now = Date.now();

      if (
        now - lastClassificationAt.current <
        CLASSIFICATION_INTERVAL_MS
      ) {
        return;
      }

      lastClassificationAt.current = now;

      const candidate = classifyActivity(
        motionAverage,
        motionPeak,
        speed,
        hasGps,
      );

      const activity = stabilizeActivity(candidate);

      const sessionStart = startedAtRef.current ?? now;

      const minutes = Math.max(
        0.1,
        (now - sessionStart) / 60000,
      );

      const calories = estimateCalories(
        activity,
        minutes,
        70,
        30,
        "male",
      );

      setSnapshot((current) => ({
        ...current,
        activity,
        calories,
        accelerationMagnitude,
        motionAverage,
        motionPeak,
        speedKmh: speed,
      }));
    },
    [
      classifyActivity,
      estimateCalories,
      stabilizeActivity,
    ],
  );

  const onMotion = useCallback(
    (event: DeviceMotionEvent) => {
      if (startedAtRef.current === null) {
        return;
      }

      const acceleration =
        event.acceleration;

      const accelerationWithGravity =
        event.accelerationIncludingGravity;

      let x = 0;
      let y = 0;
      let z = 0;

      if (acceleration) {
        x = acceleration.x ?? 0;
        y = acceleration.y ?? 0;
        z = acceleration.z ?? 0;
      } else if (accelerationWithGravity) {
        x = accelerationWithGravity.x ?? 0;
        y = accelerationWithGravity.y ?? 0;
        z = accelerationWithGravity.z ?? 0;
      } else {
        return;
      }

      motionAvailable.current = true;

      const magnitude = Math.sqrt(
        x ** 2 + y ** 2 + z ** 2,
      );

      /*
       * When accelerationIncludingGravity is used, remove
       * approximate gravity from the magnitude.
       */
      const dynamicMagnitude = acceleration
        ? magnitude
        : Math.abs(magnitude - 9.81);

      const safeMotion = Number.isFinite(dynamicMagnitude)
        ? dynamicMagnitude
        : 0;

      const samples = [
        ...motionSamples.current.slice(-29),
        safeMotion,
      ];

      motionSamples.current = samples;

      const average =
        samples.reduce(
          (sum, value) => sum + value,
          0,
        ) / samples.length;

      const peak = Math.max(...samples);

      const now = Date.now();

      /*
       * Step detection uses a threshold crossing rather than
       * counting every high-frequency sensor sample.
       */
      const crossedThreshold =
        safeMotion >= STEP_THRESHOLD &&
        lastMotionValue.current < STEP_THRESHOLD;

      if (
        crossedThreshold &&
        now - lastStepAt.current >= STEP_COOLDOWN_MS
      ) {
        stepCount.current += 1;
        lastStepAt.current = now;
      }

      lastMotionValue.current = safeMotion;

      const currentSpeed = smoothedSpeed.current;

      updateActivity(
        currentSpeed,
        lastCoordinates.current !== null,
        safeMotion,
        average,
        peak,
      );

      setSnapshot((current) => ({
        ...current,
        steps: stepCount.current,
        accelerationMagnitude: safeMotion,
        motionAverage: average,
        motionPeak: peak,
        distanceMeters:
          gpsDistance.current > 0
            ? gpsDistance.current
            : strideDistanceMeters(
                stepCount.current,
                DEFAULT_STRIDE_METERS,
              ),
      }));
    },
    [updateActivity],
  );

  const onPosition = useCallback(
    (position: GeolocationPosition) => {
      if (startedAtRef.current === null) {
        return;
      }

      const accuracy =
        Number.isFinite(position.coords.accuracy)
          ? position.coords.accuracy
          : 999;

      const next: Coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy,
      };

      const now = Date.now();

      const previous =
        lastCoordinates.current;

      const previousAt =
        lastLocationAt.current;

      /*
       * Don't add poor-quality GPS fixes to distance.
       */
      if (accuracy > GPS_MAX_ACCURACY_METERS) {
        setSnapshot((current) => ({
          ...current,
          coordinates: next,
          permissionError:
            `GPS accuracy is low (±${Math.round(accuracy)}m). Waiting for a better fix.`,
        }));

        return;
      }

      let delta = 0;
      let calculatedSpeed = 0;

      if (previous && previousAt) {
        delta = haversineMeters(
          previous,
          next,
        );

        const seconds = Math.max(
          1,
          (now - previousAt) / 1000,
        );

        calculatedSpeed =
          (delta / seconds) * 3.6;
      }

      /*
       * Prefer browser-provided GPS speed when valid.
       */
      const browserSpeed =
        Number.isFinite(position.coords.speed) &&
        (position.coords.speed ?? -1) >= 0
          ? (position.coords.speed ?? 0) * 3.6
          : null;

      let rawSpeed =
        browserSpeed !== null
          ? browserSpeed
          : calculatedSpeed;

      /*
       * Reject obvious GPS jumps.
       */
      if (
        rawSpeed > GPS_MAX_REASONABLE_SPEED_KMH
      ) {
        rawSpeed = lastSpeed.current;
        delta = 0;
      }

      const validSpeed = Math.max(
        0,
        Number.isFinite(rawSpeed)
          ? rawSpeed
          : 0,
      );

      /*
       * Smooth GPS speed so a single noisy fix doesn't
       * instantly change walking -> running.
       */
      const speedSamples = [
        ...gpsSpeedSamples.current.slice(-4),
        validSpeed,
      ];

      gpsSpeedSamples.current = speedSamples;

      const averageSpeed =
        speedSamples.reduce(
          (sum, value) => sum + value,
          0,
        ) / speedSamples.length;

      smoothedSpeed.current = averageSpeed;
      lastSpeed.current = averageSpeed;

      /*
       * Only add reasonable GPS movement to distance.
       */
      if (
        previous &&
        delta > 0 &&
        delta < 100
      ) {
        gpsDistance.current += delta;
      }

      lastCoordinates.current = next;
      lastLocationAt.current = now;

      const currentMotionAverage =
        motionSamples.current.length > 0
          ? motionSamples.current.reduce(
              (sum, value) => sum + value,
              0,
            ) / motionSamples.current.length
          : 0;

      const currentMotionPeak =
        motionSamples.current.length > 0
          ? Math.max(
              ...motionSamples.current,
            )
          : 0;

      updateActivity(
        averageSpeed,
        true,
        motionSamples.current.at(-1) ?? 0,
        currentMotionAverage,
        currentMotionPeak,
      );

      const sessionStart =
        startedAtRef.current ?? now;

      const minutes = Math.max(
        0.1,
        (now - sessionStart) / 60000,
      );

      const activity = stabilizeActivity(
        classifyActivity(
          currentMotionAverage,
          currentMotionPeak,
          averageSpeed,
          true,
        ),
      );

      const calories = estimateCalories(
        activity,
        minutes,
        70,
        30,
        "male",
      );

      setSnapshot((current) => ({
        ...current,
        coordinates: next,
        route: [
          ...current.route.slice(-399),
          next,
        ],
        distanceMeters:
          gpsDistance.current > 0
            ? gpsDistance.current
            : strideDistanceMeters(
                current.steps,
                DEFAULT_STRIDE_METERS,
              ),
        speedKmh: averageSpeed,
        calories,
        activity,
        permissionError: null,
      }));
    },
    [
      classifyActivity,
      estimateCalories,
      haversineMeters,
      stabilizeActivity,
      updateActivity,
    ],
  );

  const onGpsError = useCallback(
    (error: GeolocationPositionError) => {
      /*
       * A temporary GPS failure should NOT turn an active
       * session into "error". Motion tracking can continue.
       */
      let message =
        "GPS temporarily unavailable. Using motion data.";

      if (
        error.code ===
        error.PERMISSION_DENIED
      ) {
        message =
          "GPS permission denied. Motion tracking can still continue.";
      }

      setSnapshot((current) => ({
        ...current,
        permissionError: message,
      }));
    },
    [],
  );

  const start = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("geolocation" in navigator)
    ) {
      setSnapshot((current) => ({
        ...current,
        state: "unsupported",
        permissionError:
          "This browser does not support GPS.",
      }));

      return false;
    }

    setSnapshot((current) => ({
      ...current,
      state: "requesting",
      permissionError: null,
    }));

    try {
      /*
       * Request motion permission where supported.
       * GPS should still work if motion permission isn't
       * available.
       */
      try {
        const motion =
          window.DeviceMotionEvent as typeof DeviceMotionEvent & {
            requestPermission?: () => Promise<string>;
          };

        if (motion.requestPermission) {
          const permission =
            await motion.requestPermission();

          if (permission === "granted") {
            motionAvailable.current = true;
          } else {
            motionAvailable.current = false;
          }
        }
      } catch {
        motionAvailable.current = false;
      }

      const position =
        await new Promise<GeolocationPosition>(
          (resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
              resolve,
              (error) =>
                reject(
                  new Error(
                    error.message ||
                      "Unable to access GPS.",
                  ),
                ),
              {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
              },
            );
          },
        );

      const startTime = Date.now();

      startedAtRef.current = startTime;
      setStartedAt(startTime);

      stepCount.current = 0;
      gpsDistance.current = 0;

      lastStepAt.current = 0;
      lastMotionValue.current = 0;

      lastCoordinates.current = null;
      lastLocationAt.current = null;

      lastSpeed.current = 0;
      smoothedSpeed.current = 0;

      motionSamples.current = [];
      gpsSpeedSamples.current = [];

      lastClassificationAt.current = 0;

      stableActivity.current = "stationary";
      candidateActivity.current =
        "stationary";
      candidateCount.current = 0;

      const initialCoords: Coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy:
          position.coords.accuracy,
      };

      lastCoordinates.current =
        initialCoords;

      lastLocationAt.current = startTime;

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
        accelerationMagnitude: 0,
        motionAverage: 0,
        motionPeak: 0,
      }));

      if (
        watchIdRef.current !== null
      ) {
        navigator.geolocation.clearWatch(
          watchIdRef.current,
        );
      }

      watchIdRef.current =
        navigator.geolocation.watchPosition(
          onPosition,
          onGpsError,
          {
            enableHighAccuracy: true,
            maximumAge: 3000,
            timeout: 10000,
          },
        );

      window.addEventListener(
        "devicemotion",
        onMotion,
      );

      return true;
    } catch (error) {
      startedAtRef.current = null;
      setStartedAt(null);

      setSnapshot((current) => ({
        ...current,
        state: "denied",
        permissionError:
          error instanceof Error
            ? error.message
            : "Permission not granted.",
      }));

      return false;
    }
  }, [
    onGpsError,
    onMotion,
    onPosition,
  ]);

  const stop = useCallback(() => {
    /*
     * Remove motion listener BEFORE clearing the session.
     */
    window.removeEventListener(
      "devicemotion",
      onMotion,
    );

    if (
      watchIdRef.current !== null
    ) {
      navigator.geolocation.clearWatch(
        watchIdRef.current,
      );

      watchIdRef.current = null;
    }

    startedAtRef.current = null;
    setStartedAt(null);

    stepCount.current = 0;
    gpsDistance.current = 0;

    lastStepAt.current = 0;
    lastMotionValue.current = 0;

    lastCoordinates.current = null;
    lastLocationAt.current = null;

    lastSpeed.current = 0;
    smoothedSpeed.current = 0;

    motionSamples.current = [];
    gpsSpeedSamples.current = [];

    stableActivity.current = "stationary";
    candidateActivity.current =
      "stationary";
    candidateCount.current = 0;

    setSnapshot((current) => ({
      ...current,
      state: "idle",
      speedKmh: 0,
      activity: "stationary",
      coordinates: null,
      route: [],
      accelerationMagnitude: 0,
      motionAverage: 0,
      motionPeak: 0,
    }));
  }, [onMotion]);

  useEffect(() => {
    return () => {
      window.removeEventListener(
        "devicemotion",
        onMotion,
      );

      if (
        watchIdRef.current !== null
      ) {
        navigator.geolocation.clearWatch(
          watchIdRef.current,
        );
      }
    };
  }, [onMotion]);

  return {
    ...snapshot,
    startedAt,
    start,
    stop,
    isOnline,
    motionAvailable:
      motionAvailable.current,
  };
}

function strideDistanceMeters(
  steps: number,
  stride: number,
) {
  return (
    Math.max(0, steps) * stride
  );
}