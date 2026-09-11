
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { usePhoneSensors } from "@/hooks/usePhoneSensors";
import { readQueuedSessions, queueSensorSession } from "@/storage/offlineQueue";
import { buildPhoneSyncPayload } from "@/services/synchronization/activitySync";
import {
  Activity,
  ArrowUpRight,
  BatteryMedium,
  Bell,
  Bluetooth,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  Footprints,
  HeartPulse,
  History,
  Home as HomeIcon,
  MapPin,
  Menu,
  Moon,
  MoreHorizontal,
  Play,
  Route,
  Settings2,
  ShieldCheck,
  Target,
  Timer,
  TrendingUp,
  Watch,
  Wifi,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import WeightPromptModal from "@/components/WeightPromptModal";
import LoginModal from "@/components/LoginModal";

const routeTextureUrl =
  "/manus-storage/real-personal-tracker-route-texture_1027fb1e.png";
const recoveryArtUrl =
  "/manus-storage/real-personal-tracker-recovery-art_b09e2d2c.png";
const motionArtUrl =
  "/manus-storage/real-personal-tracker-motion-art_e5372933.png";

type GoalMetric =
  | "steps"
  | "distance"
  | "exercise"
  | "calories"
  | "sleep";
type DailyGoal = { id: string; metric: GoalMetric; target: number };
type PersonalTask = {
  id: string;
  title: string;
  note: string;
  done: boolean;
};
type Coordinates = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

// ✅ Timestamp helper
const normalizeTimestampMs = (timestamp: number): number => {
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  // Unix seconds -> milliseconds
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
};

const goalLabels: Record<
  GoalMetric,
  { label: string; unit: string }
> = {
  steps: { label: "Steps", unit: "steps" },
  distance: { label: "Distance", unit: "km" },
  exercise: { label: "Exercise", unit: "minutes" },
  calories: { label: "Active calories", unit: "kcal" },
  sleep: { label: "Sleep", unit: "hours" },
};

const navItems: Array<{ label: string; icon: LucideIcon }> = [
  { label: "Overview", icon: HomeIcon },
  { label: "Health", icon: HeartPulse },
  { label: "Activity", icon: Activity },
  { label: "Goals", icon: Target },
  { label: "Analytics", icon: TrendingUp },
];

const sectionIds: Record<string, string> = {
  Overview: "overview-section",
  Activity: "activity-section",
  Health: "health-section",
  Goals: "goals-section",
  Analytics: "analytics-section",
  Location: "location-section",
  History: "history-section",
  "Connected devices": "sync-section",
};

function ProgressRing({
  value,
  hasGoal,
  size = 148,
  stroke = 10,
}: {
  value: number;
  hasGoal: boolean;
  size?: number;
  stroke?: number;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        aria-label={
          hasGoal ? `${value}% complete` : "No step goal configured"
        }
        role="img"
      >
        <circle
          className="ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="ring-label">
        <strong>{hasGoal ? `${value}%` : "—"}</strong>
        <span>{hasGoal ? "of goal" : "no goal"}</span>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  change,
  tone = "ink",
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit: string;
  change: string;
  tone?: string;
  detail: string;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-top">
        <span className="metric-icon">
          <Icon size={17} strokeWidth={2} />
        </span>
        <span className="metric-change">{change}</span>
      </div>
      <p className="eyebrow">{label}</p>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}

export default function Home() {
  const {
    user,
    isAuthenticated,
    login,
    logout,
    showLoginModal,
    setShowLoginModal,
    loading,
  } = useAuth({
    redirectOnUnauthenticated: true,
  });

  const phoneSensors = usePhoneSensors();
  const [now, setNow] = useState(() => new Date());
  const [activeNav, setActiveNav] = useState("Overview");
  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [sleepEditing, setSleepEditing] = useState(false);

  // ✅ Fixed: historyWindow using useMemo
  const historyWindow = useMemo(
    () => ({
      from: now.getTime() - 30 * 24 * 60 * 60 * 1000,
      to: now.getTime(),
    }),
    [now],
  );

  const historyQuery = trpc.activity.history.useQuery(historyWindow, {
    enabled: isAuthenticated,
    retry: 1,
  });
  const syncStatusQuery = trpc.activity.syncStatus.useQuery(
    { source: "phone", deviceId: "browser-phone" },
    { enabled: isAuthenticated, retry: 1 },
  );

  const [restSyncing, setRestSyncing] = useState(false);
  const [restSyncError, setRestSyncError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [timeRange, setTimeRange] = useState("Week");
  const [goals, setGoals] = useState<DailyGoal[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(
          "roxan-personal-assistant:daily-goals",
        ) || "[]",
      ) as DailyGoal[];
    } catch {
      return [];
    }
  });
  const [tasks, setTasks] = useState<PersonalTask[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(
          "roxan-personal-assistant:daily-tasks",
        ) || "[]",
      ) as PersonalTask[];
    } catch {
      return [];
    }
  });
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [goalMetric, setGoalMetric] = useState<GoalMetric>("steps");
  const [goalTarget, setGoalTarget] = useState(8000);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskNote, setTaskNote] = useState("");

  // Weight Prompt States
  const [showWeightPrompt, setShowWeightPrompt] = useState(false);
  const [sessionData, setSessionData] = useState<any>(null);

  // ✅ Fixed: queuedSessions as state so it updates immediately after queueing
  const [queuedSessions, setQueuedSessions] = useState(
    () => readQueuedSessions().length,
  );

  // useRefs for Click Outside
  const sleepEditorRef = useRef<HTMLDivElement>(null);
  const goalModalRef = useRef<HTMLDivElement>(null);
  const taskModalRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);

  // Click Outside Handlers
  useEffect(() => {
    if (!sleepEditing) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sleepEditorRef.current &&
        !sleepEditorRef.current.contains(event.target as Node)
      ) {
        setSleepEditing(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, [sleepEditing]);

  useEffect(() => {
    if (!goalDialogOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        goalModalRef.current &&
        !goalModalRef.current.contains(event.target as Node)
      ) {
        setGoalDialogOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, [goalDialogOpen]);

  useEffect(() => {
    if (!taskDialogOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        taskModalRef.current &&
        !taskModalRef.current.contains(event.target as Node)
      ) {
        setTaskDialogOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, [taskDialogOpen]);

  useEffect(() => {
    if (!showMobileNav) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node)
      ) {
        setShowMobileNav(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, [showMobileNav]);

  const handleLogin = (name: string) => {
    login(name);
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "roxan-personal-assistant:daily-goals",
      JSON.stringify(goals),
    );
  }, [goals]);
  useEffect(() => {
    localStorage.setItem(
      "roxan-personal-assistant:daily-tasks",
      JSON.stringify(tasks),
    );
  }, [tasks]);

  const records = historyQuery.data ?? [];
  const dayStart = useMemo(() => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }, [now]);

  // ✅ Fixed: normalize recordedAt so seconds/ms mismatch doesn't break today filter
  const todayRecords = useMemo(
    () =>
      records.filter(
        (record: any) =>
          normalizeTimestampMs(record.recordedAt) >= dayStart,
      ),
    [records, dayStart],
  );
  const todaySummary = useMemo(
    () =>
      todayRecords.reduce(
        (total: any, record: any) => ({
          steps: total.steps + record.steps,
          distanceMeters:
            total.distanceMeters + record.distanceMeters,
          activeSeconds:
            total.activeSeconds + record.activeSeconds,
          calories: total.calories + record.calories,
        }),
        {
          steps: 0,
          distanceMeters: 0,
          activeSeconds: 0,
          calories: 0,
        },
      ),
    [todayRecords],
  );

  // ✅ Fixed: use now.getTime() so the live duration updates every 30s
  const liveSession =
    phoneSensors.state === "active"
      ? {
          steps: phoneSensors.steps,
          distanceMeters: phoneSensors.distanceMeters,
          activeSeconds: phoneSensors.startedAt
            ? Math.round(
                (now.getTime() - phoneSensors.startedAt) / 1000,
              )
            : 0,
          calories: phoneSensors.calories,
        }
      : { steps: 0, distanceMeters: 0, activeSeconds: 0, calories: 0 };

  const daily = {
    steps: todaySummary.steps + liveSession.steps,
    distanceMeters:
      todaySummary.distanceMeters + liveSession.distanceMeters,
    activeSeconds:
      todaySummary.activeSeconds + liveSession.activeSeconds,
    calories: todaySummary.calories + liveSession.calories,
  };

  // ✅ Fixed: derive stepGoal from the goals list instead of permanently-null state
  const stepGoal =
    goals.find((goal) => goal.metric === "steps")?.target ?? null;

  const stepProgress = stepGoal
    ? Math.min(100, Math.round((daily.steps / stepGoal) * 100))
    : 0;

  // ✅ Fixed: recentHistory sorting instead of assuming API order
  const recentHistory = useMemo(
    () =>
      [...records]
        .sort(
          (a: any, b: any) =>
            normalizeTimestampMs(b.recordedAt) -
            normalizeTimestampMs(a.recordedAt),
        )
        .slice(0, 3),
    [records],
  );

  const routePath = useMemo(() => {
    if (phoneSensors.route.length < 2) return "";
    const latitudes = phoneSensors.route.map(
      (point: Coordinates) => point.latitude,
    );
    const longitudes = phoneSensors.route.map(
      (point: Coordinates) => point.longitude,
    );
    const minLat = Math.min(...latitudes),
      maxLat = Math.max(...latitudes),
      minLon = Math.min(...longitudes),
      maxLon = Math.max(...longitudes);
    const latSpan = Math.max(maxLat - minLat, 0.00001),
      lonSpan = Math.max(maxLon - minLon, 0.00001);
    return phoneSensors.route
      .map(
        (point: Coordinates, index: number) =>
          `${index === 0 ? "M" : "L"} ${((point.longitude - minLon) / lonSpan) * 100} ${100 - ((point.latitude - minLat) / latSpan) * 100}`,
      )
      .join(" ");
  }, [phoneSensors.route]);

  const completedCount = tasks.filter(
    (task: PersonalTask) => task.done,
  ).length;
  const activityMinutes = Math.round(daily.activeSeconds / 60);

  const goalCurrentValue = (metric: GoalMetric) =>
    metric === "steps"
      ? daily.steps
      : metric === "distance"
        ? daily.distanceMeters / 1000
        : metric === "exercise"
          ? activityMinutes
          : metric === "calories"
            ? daily.calories
            : (sleepHours ?? 0);

  // ✅ Fixed: use FormEvent type import instead of React.FormEvent
  const addGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setGoals((current) => [
      ...current.filter((goal) => goal.metric !== goalMetric),
      {
        id: crypto.randomUUID(),
        metric: goalMetric,
        target: Math.max(0.25, Number(goalTarget)),
      },
    ]);
    setGoalDialogOpen(false);
  };

  // ✅ Fixed: use FormEvent type import instead of React.FormEvent
  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title) return;
    setTasks((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        title,
        note: taskNote.trim(),
        done: false,
      },
    ]);
    setTaskTitle("");
    setTaskNote("");
    setTaskDialogOpen(false);
  };

  const firstName =
    user?.name?.trim().split(/\s+/)[0] ?? "there";
  const initials =
    user?.name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part: string) => part[0])
      .join("")
      .toUpperCase() || "—";
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 18
        ? "Good afternoon"
        : "Good evening";
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const dateShortLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  // ✅ Fixed: historyLabel with normalizeTimestampMs
  const historyLabel = !phoneSensors.isOnline
    ? "Offline · queued locally"
    : restSyncing
      ? "Uploading session"
      : restSyncError
        ? "Sync needs attention"
        : syncStatusQuery.isLoading
          ? "Checking phone sync"
          : syncStatusQuery.error
            ? "Sync needs attention"
            : syncStatusQuery.data?.lastSyncedAt
              ? (() => {
                  const syncedAt = normalizeTimestampMs(
                    syncStatusQuery.data.lastSyncedAt,
                  );
                  const minutes = Math.max(
                    1,
                    Math.round((Date.now() - syncedAt) / 60000),
                  );
                  return `Last synced ${minutes} min ago`;
                })()
              : "Phone not synced yet";

  // ✅ Fixed: normalize recordedAt inside the chart filter too
  const chartBars = useMemo(
    () =>
      Array.from(
        { length: timeRange === "Week" ? 7 : 30 },
        (_, index) => {
          const date = new Date(
            dayStart -
              ((timeRange === "Week" ? 6 : 29) - index) *
                24 *
                60 *
                60 *
                1000,
          );
          const start = date.getTime();
          const end = start + 24 * 60 * 60 * 1000;
          const value = records
            .filter((record: any) => {
              const recordedAtMs = normalizeTimestampMs(
                record.recordedAt,
              );
              return recordedAtMs >= start && recordedAtMs < end;
            })
            .reduce(
              (sum: number, record: any) => sum + record.steps,
              0,
            );
          return {
            day: new Intl.DateTimeFormat(undefined, {
              weekday: "short",
            }).format(date),
            value,
          };
        },
      ),
    [records, dayStart, timeRange],
  );
  const chartMax = Math.max(
    ...chartBars.map((bar: any) => bar.value),
    1,
  );

  const goTo = (label: string) => {
    setActiveNav(label);
    setShowMobileNav(false);
    const target = sectionIds[label];
    if (target)
      document
        .getElementById(target)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ✅ Fixed: syncSessionWithWeight now returns boolean success/failure and verifies history
  const syncSessionWithWeight = async (
    session: any,
    actualCalories: number,
  ): Promise<boolean> => {
    const updatedSession = {
      ...session,
      calories: actualCalories,
    };

    setRestSyncing(true);
    setRestSyncError(null);

    try {
      const payload = buildPhoneSyncPayload(updatedSession);

      const response = await fetch("/api/activity/sync", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseBody = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          responseBody?.error ||
            responseBody?.message ||
            `Activity sync failed (${response.status})`,
        );
      }

      console.log("REST activity sync response:", responseBody);

      // Refetch both queries only after the POST has completed successfully.
      const [historyResult, statusResult] = await Promise.all([
        historyQuery.refetch(),
        syncStatusQuery.refetch(),
      ]);

      if (historyResult.error) {
        throw historyResult.error;
      }

      if (statusResult.error) {
        throw statusResult.error;
      }

      // Confirm that the saved activity is visible to the history query.
      const syncedRecords = historyResult.data ?? [];
      const syncedExternalId = updatedSession.externalId;

      const recordWasSaved = syncedRecords.some(
        (record: any) => record.externalId === syncedExternalId,
      );

      if (!recordWasSaved) {
        throw new Error(
          "Sync completed, but the saved activity was not returned by history.",
        );
      }

      console.log(
        "Session synced and confirmed:",
        updatedSession.externalId,
      );

      return true;
    } catch (error) {
      console.error("Activity sync error:", error);

      setRestSyncError(
        error instanceof Error
          ? error.message
          : "Activity sync unavailable",
      );
      return false;
    } finally {
      setRestSyncing(false);
    }
  };

  // ✅ Fixed: toggleTracking
  const toggleTracking = async () => {
    if (isTracking) {
      /*
       * Capture everything BEFORE stopping the sensor.
       * stop() intentionally clears the live GPS route.
       */
      const sessionStartedAt = phoneSensors.startedAt;

      const hasMeaningfulActivity =
        phoneSensors.steps > 0 ||
        phoneSensors.distanceMeters >= 10 ||
        phoneSensors.speedKmh >= 1.0 ||
        phoneSensors.route.length >= 2 ||
        phoneSensors.activity !== "stationary";

      if (!hasMeaningfulActivity) {
        phoneSensors.stop();
        setIsTracking(false);
        console.log(
          "Session ignored: no meaningful activity detected.",
        );
        return;
      }

      const session = {
        externalId: `phone-session-${Date.now()}`,
        recordedAt: Date.now(),
        activityType: phoneSensors.activity,
        steps: Math.max(0, phoneSensors.steps),
        distanceMeters: Math.round(phoneSensors.distanceMeters),
        activeSeconds: sessionStartedAt
          ? Math.max(
              0,
              Math.round((Date.now() - sessionStartedAt) / 1000),
            )
          : 0,
        calories: Math.max(0, phoneSensors.calories),
        avgHeartRate: null as null,
        route: [...phoneSensors.route],
      };

      /*
       * Now stop the sensors.
       * The session object already contains the route.
       */
      phoneSensors.stop();
      setIsTracking(false);

      /*
       * Save the session temporarily.
       * It will NOT be queued yet.
       *
       * This is important because the final calorie value
       * depends on the weight entered by the user.
       */
      setSessionData(session);
      setShowWeightPrompt(true);

      return;
    }

    const started = await phoneSensors.start();
    setIsTracking(started);
  };

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside
        className={`sidebar ${showMobileNav ? "open" : ""}`}
        ref={mobileMenuRef}
      >
        <div className="brand-lockup">
          <span>
            roxan<br />
            <strong>personal</strong>
            <br />
            assistant
          </span>
        </div>
        <button
          className="close-mobile"
          onClick={() => setShowMobileNav(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
        <div className="rail-label">Workspace</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => (
            <button
              className={activeNav === label ? "active" : ""}
              key={label}
              onClick={() => goTo(label)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {activeNav === label && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="rail-label second">Your systems</div>
        <nav className="system-nav">
          <button
            className={activeNav === "Location" ? "active" : ""}
            onClick={() => goTo("Location")}
          >
            <MapPin size={18} />
            <span>Location</span>
            <span className="live-pill">
              {phoneSensors.state === "active" ? "Live" : "Idle"}
            </span>
          </button>
          <button
            className={
              activeNav === "Connected devices" ? "active" : ""
            }
            onClick={() => goTo("Connected devices")}
          >
            <Watch size={18} />
            <span>Connected devices</span>
          </button>
          <button
            className={activeNav === "History" ? "active" : ""}
            onClick={() => goTo("History")}
          >
            <History size={18} />
            <span>History</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <div>
              <strong>Your data is private</strong>
              <span>Protected account storage</span>
            </div>
          </div>
          <button
            className="profile"
            onClick={() => {
              console.log(
                "Profile clicked - isAuthenticated:",
                isAuthenticated,
              );
              if (isAuthenticated) {
                console.log(
                  "User is authenticated, showing logout confirm",
                );
                if (confirm("Are you sure you want to logout?")) {
                  logout();
                }
              } else {
                console.log(
                  "User not authenticated, opening login modal",
                );
                setShowLoginModal(true);
              }
            }}
          >
            <span className="avatar">{initials}</span>
            <span>
              <strong>{user?.name ?? "Your account"}</strong>
              <small>
                {isAuthenticated
                  ? "Personal account"
                  : "Tap to sign in"}
              </small>
            </span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setShowMobileNav(true)}
            aria-label="Open navigation"
          >
            <Menu size={21} />
          </button>
          <div className="topbar-context">
            <span
              className={`status-dot ${!phoneSensors.isOnline ? "offline" : ""}`}
            />
            {phoneSensors.isOnline ? "Workspace ready" : "Offline mode"}
            <span className="slash">/</span> {historyLabel}
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label="Notifications"
            >
              <Bell size={19} />
            </button>
            <button className="icon-button" aria-label="Help">
              <CircleHelp size={19} />
            </button>
            <button className="date-button">
              <CalendarDays size={17} /> <span>{dateShortLabel}</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </header>

        <div className="content-wrap" id="overview-section">
          {/* Welcome Section */}
          <section className="section-vertical">
            <div className="welcome-section">
              <div>
                <p className="eyebrow accent-eyebrow">
                  {dateLabel} <span className="sun-mark">✦</span>
                </p>
                <h1>
                  {greeting}, {firstName}
                  <span className="serif-dot">.</span>
                </h1>
                <p className="intro-copy">
                  {isAuthenticated
                    ? `Your assistant is ready at ${timeLabel}.`
                    : "Sign in to keep your personal history synced across sessions."}
                </p>
              </div>
              <div
                className={`sync-status ${isTracking ? "tracking" : ""}`}
              >
                <span className="sync-pulse" />
                <div>
                  <strong>
                    {isTracking
                      ? `Live tracking · ${phoneSensors.activity}`
                      : phoneSensors.state === "denied" ||
                          phoneSensors.state === "unsupported"
                        ? "Permission needed"
                        : "Ready to track"}
                  </strong>
                  <span>
                    {isTracking
                      ? `${phoneSensors.steps} steps · ${phoneSensors.speedKmh.toFixed(1)} km/h`
                      : phoneSensors.permissionError ??
                        "Start a foreground phone sensor session"}
                  </span>
                </div>
                <button onClick={() => void toggleTracking()}>
                  {isTracking ? "Pause" : "Start a session"}
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
          </section>

          {/* Daily Pulse */}
          <section className="section-vertical">
            <article className="daily-pulse panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Daily pulse</p>
                  <h2>Movement, in context</h2>
                </div>
                <button
                  className="more-button"
                  aria-label="Daily pulse information"
                >
                  <MoreHorizontal size={19} />
                </button>
              </div>
              <div className="pulse-body">
                <div className="pulse-ring-wrap">
                  <ProgressRing
                    value={stepProgress}
                    hasGoal={Boolean(stepGoal)}
                  />
                  <span className="ring-caption">
                    {stepGoal
                      ? `${Math.max(0, stepGoal - daily.steps).toLocaleString()} steps to go`
                      : "Set a step goal to track progress"}
                  </span>
                </div>
                <div className="pulse-stats">
                  <div>
                    <span className="stat-label">
                      <Footprints size={14} /> Steps
                    </span>
                    <strong>
                      {daily.steps.toLocaleString()}
                      {stepGoal && (
                        <small>/ {stepGoal.toLocaleString()}</small>
                      )}
                    </strong>
                    {stepGoal && (
                      <div className="mini-progress">
                        <i style={{ width: `${stepProgress}%` }} />
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="stat-label">
                      <Route size={14} /> Distance
                    </span>
                    <strong>
                      {daily.distanceMeters
                        ? (daily.distanceMeters / 1000).toFixed(2)
                        : "—"}
                      <small>{daily.distanceMeters ? "km" : ""}</small>
                    </strong>
                    <p>
                      {daily.distanceMeters
                        ? "From phone GPS or step fallback"
                        : "No distance recorded"}
                    </p>
                  </div>
                  <div>
                    <span className="stat-label">
                      <Timer size={14} /> Active time
                    </span>
                    <strong>
                      {activityMinutes ? activityMinutes : "—"}
                      <small>{activityMinutes ? "min" : ""}</small>
                    </strong>
                    <p>
                      {activityMinutes
                        ? "From recorded sessions"
                        : "No session recorded"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="pulse-foot">
                <span>
                  <span className="tiny-dot citron" />
                  {daily.steps
                    ? "Live data available"
                    : "Waiting for your first activity"}
                </span>
                <button onClick={() => goTo("Activity")}>
                  Open activity <ArrowUpRight size={14} />
                </button>
              </div>
            </article>
          </section>

          {/* Current Activity */}
          <section className="section-vertical">
            <article className="now-card panel">
              <div
                className="now-image"
                style={{ backgroundImage: `url(${motionArtUrl})` }}
              >
                <div className="image-overlay" />
                <div className="now-top">
                  <span className="live-pill dark">
                    <span className="tiny-dot citron" />
                    {isTracking ? "Live" : "Idle"}
                  </span>
                  <button
                    className="glass-button"
                    aria-label="Current activity information"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </div>
                <div className="now-copy">
                  <p className="eyebrow light">Current activity</p>
                  <h2>
                    {isTracking
                      ? phoneSensors.activity
                      : "No active session"}
                  </h2>
                  <span>
                    {isTracking
                      ? `${phoneSensors.steps} steps · ${(phoneSensors.distanceMeters / 1000).toFixed(2)} km`
                      : "Start tracking when you are ready"}
                  </span>
                </div>
              </div>
              <div className="now-footer">
                <div>
                  <span className="footer-label">
                    <HeartPulse size={14} /> Heart rate
                  </span>
                  <strong>
                    — <small>BPM</small>
                  </strong>
                </div>
                <div>
                  <span className="footer-label">
                    <BatteryMedium size={14} /> Device battery
                  </span>
                  <strong>—</strong>
                </div>
                <button
                  className="play-button"
                  onClick={() => void toggleTracking()}
                  aria-label={
                    isTracking ? "Pause session" : "Start session"
                  }
                >
                  {isTracking ? (
                    <span className="pause-bars" />
                  ) : (
                    <Play size={15} fill="currentColor" />
                  )}
                </button>
              </div>
            </article>
          </section>

          {/* Today at a Glance */}
          <section className="section-vertical" id="health-section">
            <article className="metrics-section">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Today at a glance</p>
                  <h2>The signals that matter</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => goTo("Health")}
                >
                  Open health <ArrowUpRight size={15} />
                </button>
              </div>
              {historyQuery.isLoading ? (
                <div
                  className="data-loading-state"
                  aria-live="polite"
                >
                  <span className="history-loader" />
                  <strong>Loading today's signals</strong>
                  <span>Reading your personal activity history.</span>
                </div>
              ) : (
                <div className="metrics-grid">
                  <MetricCard
                    icon={Footprints}
                    label="Steps"
                    value={daily.steps.toLocaleString()}
                    unit=""
                    change={daily.steps ? "Live" : "No data"}
                    tone="citron"
                    detail={
                      daily.steps
                        ? "From phone or synced records"
                        : "Start a session to measure steps"
                    }
                  />
                  <MetricCard
                    icon={HeartPulse}
                    label="Heart rate"
                    value="—"
                    unit=" BPM"
                    change="Not connected"
                    tone="sage"
                    detail="Connect a compatible sensor"
                  />
                  <MetricCard
                    icon={Moon}
                    label="Sleep"
                    value={
                      sleepHours !== null
                        ? `${sleepHours.toFixed(2)}h`
                        : "—"
                    }
                    unit=""
                    change={sleepHours !== null ? "Manual" : "No entry"}
                    tone="blue"
                    detail={
                      sleepHours !== null
                        ? "Basic recovery prediction available"
                        : "Add a manual sleep entry"
                    }
                  />
                  <MetricCard
                    icon={Zap}
                    label="Active calories"
                    value={daily.calories.toLocaleString()}
                    unit=" kcal"
                    change={daily.calories ? "Estimated" : "No data"}
                    tone="peach"
                    detail={
                      daily.calories
                        ? "Formula-based session estimate"
                        : "Calories appear after activity"
                    }
                  />
                </div>
              )}
            </article>
          </section>

          {/* Recovery Check-in */}
          <section className="section-vertical">
            <aside className="recovery-card panel">
              <div
                className="recovery-art"
                style={{ backgroundImage: `url(${recoveryArtUrl})` }}
              />
              <div className="recovery-copy">
                <div className="recovery-title">
                  <div>
                    <p className="eyebrow">Recovery check-in</p>
                    <h3>
                      {sleepHours !== null
                        ? "Sleep entry captured"
                        : "No sleep record yet"}
                    </h3>
                  </div>
                  <span className="score-badge">—</span>
                </div>
                <p>
                  {sleepHours !== null
                    ? `You entered ${sleepHours.toFixed(2)} hours. The basic prediction is ${sleepHours >= 7 ? "steady recovery" : "more rest may help tomorrow"}.`
                    : "Sleep recovery is not inferred without your input. Add a manual entry to begin a simple trend."}
                </p>
                <button
                  className="outline-button"
                  onClick={() => setSleepEditing(!sleepEditing)}
                >
                  {sleepEditing
                    ? "Save sleep entry"
                    : "Add sleep entry"}{" "}
                  <ArrowUpRight size={15} />
                </button>
                {sleepEditing && (
                  <div className="sleep-editor-overlay">
                    <div
                      className="sleep-editor"
                      ref={sleepEditorRef}
                    >
                      <div className="sleep-editor-header">
                        <label htmlFor="sleep-hours">
                          Last night:{" "}
                          <strong>
                            {(sleepHours ?? 7).toFixed(2)} hours
                          </strong>
                        </label>
                        <button
                          className="sleep-editor-close"
                          onClick={() => setSleepEditing(false)}
                        >
                          ×
                        </button>
                      </div>
                      <input
                        id="sleep-hours"
                        type="range"
                        min="4"
                        max="10"
                        step="0.25"
                        value={sleepHours ?? 7}
                        onChange={(event) =>
                          setSleepHours(Number(event.target.value))
                        }
                      />
                      <div className="sleep-editor-actions">
                        <button
                          className="sleep-editor-cancel"
                          onClick={() => setSleepEditing(false)}
                        >
                          Cancel
                        </button>
                        <button
                          className="sleep-editor-save"
                          onClick={() => setSleepEditing(false)}
                        >
                          Save
                        </button>
                      </div>
                      <small>
                        Basic prediction only; not a clinical measurement.
                      </small>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </section>

          {/* Activity Trend */}
          <section className="section-vertical" id="analytics-section">
            <article className="activity-chart panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Activity trend</p>
                  <h2>Recorded activity, at a glance</h2>
                </div>
                <div className="range-tabs">
                  {["Week", "Month"].map((range) => (
                    <button
                      className={timeRange === range ? "selected" : ""}
                      key={range}
                      onClick={() => setTimeRange(range)}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>
              {historyQuery.isLoading ? (
                <div className="chart-empty" aria-live="polite">
                  <span className="history-loader" />
                  <strong>Loading activity trend</strong>
                  <span>
                    Reading recorded activity from your account.
                  </span>
                </div>
              ) : records.length === 0 ? (
                <div className="chart-empty">
                  <TrendingUp size={19} />
                  <strong>No activity history yet</strong>
                  <span>
                    Complete a phone session or connect a source to build this
                    chart.
                  </span>
                </div>
              ) : (
                <>
                  <div className="chart-summary">
                    <strong>
                      {records
                        .reduce(
                          (sum: number, record: any) => sum + record.steps,
                          0,
                        )
                        .toLocaleString()}
                      <small>steps</small>
                    </strong>
                    <span className="positive">
                      <History size={14} /> {records.length} recorded{" "}
                      {records.length === 1 ? "event" : "events"}
                    </span>
                  </div>
                  <div
                    className={`bar-chart ${timeRange === "Month" ? "month-chart" : ""}`}
                  >
                    {chartBars.map((bar: any, index: number) => (
                      <div
                        className="bar-column"
                        key={`${bar.day}-${index}`}
                      >
                        <span className="bar-value">
                          {bar.value ? bar.value.toLocaleString() : "—"}
                        </span>
                        <div className="bar-track">
                          <i
                            style={{
                              height: `${bar.value ? Math.max(8, (bar.value / chartMax) * 100) : 3}%`,
                            }}
                          />
                        </div>
                        <span className="bar-day">{bar.day}</span>
                      </div>
                    ))}
                  </div>
                  <div className="chart-foot">
                    <span>
                      <span className="tiny-dot citron" />
                      Steps from stored records
                    </span>
                    <button
                      className="text-button"
                      onClick={() => goTo("History")}
                    >
                      View history <ArrowUpRight size={14} />
                    </button>
                  </div>
                </>
              )}
            </article>
          </section>

          {/* Goals & Tasks */}
          <section className="section-vertical" id="goals-section">
            <article className="goals-card panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Focus list</p>
                  <h2>Your goals and tasks</h2>
                </div>
                <div className="goal-actions">
                  <button
                    className="subtle-action"
                    onClick={() => setGoalDialogOpen(true)}
                  >
                    + Add goal
                  </button>
                  <button
                    className="subtle-action"
                    onClick={() => setTaskDialogOpen(true)}
                  >
                    + Add task
                  </button>
                  <span className="task-count">
                    {completedCount}/{tasks.length}
                  </span>
                </div>
              </div>
              {historyQuery.isLoading ? (
                <div className="empty-data">
                  <span className="history-loader" />
                  <strong>Loading goals and tasks</strong>
                  <span>Checking your personal workspace data.</span>
                </div>
              ) : goals.length === 0 && tasks.length === 0 ? (
                <div className="empty-data">
                  <Target size={19} />
                  <strong>No goals or tasks configured</strong>
                  <span>
                    Use Add goal or Add task above to plan what you want to do
                    today.
                  </span>
                </div>
              ) : (
                <div className="goal-content">
                  {goals.map((goal: DailyGoal) => {
                    const current = goalCurrentValue(goal.metric);
                    const progress = Math.min(
                      100,
                      Math.round((current / goal.target) * 100),
                    );
                    return (
                      <div className="goal-row" key={goal.id}>
                        <div className="goal-row-top">
                          <span>
                            <strong>
                              {goalLabels[goal.metric].label}
                            </strong>
                            <small>
                              {current.toFixed(
                                goal.metric === "distance" ||
                                  goal.metric === "sleep"
                                  ? 1
                                  : 0,
                              )}{" "}
                              / {goal.target}{" "}
                              {goalLabels[goal.metric].unit}
                            </small>
                          </span>
                          <button
                            className="remove-goal"
                            onClick={() =>
                              setGoals((items) =>
                                items.filter((item) => item.id !== goal.id),
                              )
                            }
                            aria-label={`Remove ${goalLabels[goal.metric].label} goal`}
                          >
                            ×
                          </button>
                        </div>
                        <div className="goal-bar">
                          <i style={{ width: `${progress}%` }} />
                        </div>
                        <small className="goal-progress-label">
                          {progress}% complete · updates from your real activity
                        </small>
                      </div>
                    );
                  })}
                  {tasks.map((task: PersonalTask) => (
                    <button
                      className={`task-item ${task.done ? "done" : ""}`}
                      key={task.id}
                      onClick={() =>
                        setTasks((items) =>
                          items.map((item) =>
                            item.id === task.id
                              ? { ...item, done: !item.done }
                              : item,
                          ),
                        )
                      }
                    >
                      <span className="task-check">
                        {task.done ? <Check size={12} /> : null}
                      </span>
                      <span>
                        <strong>{task.title}</strong>
                        {task.note && <small>{task.note}</small>}
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              )}
            </article>
          </section>

          {/* Synced History */}
          <section className="section-vertical">
            <div className="history-strip panel" id="history-section">
              <div className="history-heading">
                <div>
                  <p className="eyebrow">Synced history</p>
                  <h2>Your activity, kept in context</h2>
                </div>
                {isAuthenticated && (
                  <span
                    className={`history-source ${syncStatusQuery.error ? "attention" : ""}`}
                  >
                    <Activity size={14} />
                    {restSyncing
                      ? "Uploading session"
                      : restSyncError
                        ? "Sync error"
                        : syncStatusQuery.isLoading
                          ? "Checking sync"
                          : syncStatusQuery.error
                            ? "Sync error"
                            : syncStatusQuery.data?.lastSyncedAt
                              ? "Phone history"
                              : "Not synced yet"}
                  </span>
                )}
              </div>
              {!isAuthenticated ? (
                <div className="history-state">
                  <ShieldCheck size={18} />
                  <div>
                    <strong>
                      Sign in to sync your personal history
                    </strong>
                    <span>
                      Your records stay private and load only for your account.
                    </span>
                  </div>
                </div>
              ) : historyQuery.isLoading ? (
                <div className="history-state">
                  <span className="history-loader" />
                  <div>
                    <strong>Loading your activity history</strong>
                    <span>Fetching the last 30 days securely.</span>
                  </div>
                </div>
              ) : historyQuery.error ? (
                <div className="history-state error">
                  <X size={18} />
                  <div>
                    <strong>
                      History is temporarily unavailable
                    </strong>
                    <span>
                      We kept the dashboard available. Try again when your
                      connection is ready.
                    </span>
                  </div>
                  <button onClick={() => historyQuery.refetch()}>
                    Retry <ArrowUpRight size={14} />
                  </button>
                </div>
              ) : recentHistory.length === 0 ? (
                <div className="history-state">
                  <History size={18} />
                  <div>
                    <strong>No synced activity yet</strong>
                    <span>
                      Start a phone session or connect a source to build your
                      timeline.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="history-list">
                  {recentHistory.map((record: any) => (
                    <div className="history-item" key={record.id}>
                      <span className="history-type">
                        {record.activityType}
                      </span>
                      <span>
                        {record.steps.toLocaleString()} steps
                      </span>
                      <span>
                        {(record.distanceMeters / 1000).toFixed(2)} km
                      </span>
                      <time>
                        {new Date(
                          normalizeTimestampMs(record.recordedAt),
                        ).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </time>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Sync Status */}
          <section className="section-vertical">
            <div className="sync-status-card panel" id="sync-section">
              {!isAuthenticated ? (
                <div className="sync-inline">
                  <ShieldCheck size={17} />
                  <div>
                    <strong>Sync becomes available after sign-in</strong>
                    <span>
                      Authentication keeps personal history isolated to your
                      account.
                    </span>
                  </div>
                </div>
              ) : !phoneSensors.isOnline ? (
                <div className="sync-inline">
                  <Cloud size={17} />
                  <div>
                    <strong>Offline queue active</strong>
                    <span>
                      {queuedSessions
                        ? `${queuedSessions} session${queuedSessions === 1 ? "" : "s"} waiting locally for connection.`
                        : "New sessions will stay on this device until connection returns."}
                    </span>
                  </div>
                </div>
              ) : syncStatusQuery.isLoading ? (
                <div className="sync-inline">
                  <span className="history-loader" />
                  <div>
                    <strong>Checking phone sync</strong>
                    <span>Reading the latest device checkpoint.</span>
                  </div>
                </div>
              ) : syncStatusQuery.error || restSyncError ? (
                <div className="sync-inline error">
                  <X size={17} />
                  <div>
                    <strong>Phone sync needs attention</strong>
                    <span>
                      The dashboard is still available. Retry when your
                      connection is ready.
                    </span>
                  </div>
                  <button onClick={() => syncStatusQuery.refetch()}>
                    Retry sync <ArrowUpRight size={14} />
                  </button>
                </div>
              ) : syncStatusQuery.data?.lastSyncedAt ? (
                <div className="sync-inline">
                  <Activity size={17} />
                  <div>
                    <strong>Phone session synced successfully</strong>
                    <span>
                      Last checkpoint{" "}
                      {new Date(
                        normalizeTimestampMs(
                          syncStatusQuery.data.lastSyncedAt,
                        ),
                      ).toLocaleString()}
                      .
                    </span>
                  </div>
                  <span className="sync-ok">Ready</span>
                </div>
              ) : (
                <div className="sync-inline">
                  <Activity size={17} />
                  <div>
                    <strong>Phone connected, not synced yet</strong>
                    <span>
                      Complete a sensor session to create the first checkpoint.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Phone Sensor Session */}
          <section className="section-vertical">
            <div className="sensor-summary panel" id="activity-section">
              <div>
                <p className="eyebrow">Phone sensor session</p>
                <strong>
                  {phoneSensors.state === "active"
                    ? "Collecting live signals"
                    : "Sensors are idle"}
                </strong>
                <span>
                  {!phoneSensors.isOnline
                    ? "Offline mode · session will queue locally until connection returns."
                    : phoneSensors.coordinates
                      ? `${phoneSensors.coordinates.latitude.toFixed(4)}, ${phoneSensors.coordinates.longitude.toFixed(4)} · ±${Math.round(phoneSensors.coordinates.accuracy)}m · ${phoneSensors.route.length} route points`
                      : "GPS coordinate appears after permission is granted."}
                </span>
              </div>
              {isTracking && routePath && (
                <div
                  className="route-preview"
                  aria-label={`${phoneSensors.route.length} GPS route points captured`}
                >
                  <svg viewBox="0 0 100 100" role="img">
                    <path d={routePath} />
                  </svg>
                  <small>Live GPS route</small>
                </div>
              )}
              <div className="sensor-values">
                <span>
                  <strong>{phoneSensors.steps.toLocaleString()}</strong>{" "}
                  steps
                </span>
                <span>
                  <strong>{phoneSensors.speedKmh.toFixed(1)}</strong>{" "}
                  km/h
                </span>
                <span>
                  <strong>
                    {phoneSensors.calories.toLocaleString()}
                  </strong>{" "}
                  kcal est.
                </span>
              </div>
              {phoneSensors.permissionError && (
                <span className="sensor-error">
                  {phoneSensors.permissionError}
                </span>
              )}
            </div>
          </section>

          {/* Location System */}
          <section className="section-vertical">
            <div
              className="location-strip panel"
              id="location-section"
              style={{
                backgroundImage: `linear-gradient(90deg, rgba(12, 34, 43, .97) 0%, rgba(12, 34, 43, .83) 52%, rgba(12, 34, 43, .52) 100%), url(${routeTextureUrl})`,
              }}
            >
              <div className="location-copy">
                <div className="location-icon">
                  <MapPin size={18} />
                </div>
                <div>
                  <p className="eyebrow light">Location system</p>
                  <h2>
                    {phoneSensors.coordinates
                      ? "Location available"
                      : "Location permission needed"}
                  </h2>
                  <p>
                    {phoneSensors.coordinates
                      ? `Current accuracy ±${Math.round(phoneSensors.coordinates.accuracy)}m. Location is used only during an active session.`
                      : "Start an outdoor session to request phone GPS access. No route is stored until a session is completed."}
                  </p>
                </div>
              </div>
              <div className="location-actions">
                <span className="connection-state">
                  <Wifi size={15} />{" "}
                  {phoneSensors.coordinates
                    ? "GPS available"
                    : "GPS idle"}
                </span>
                <button
                  className="light-button"
                  onClick={() => {
                    void toggleTracking();
                    goTo("Activity");
                  }}
                >
                  {isTracking ? "Pause activity" : "Start outdoor activity"}{" "}
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
          </section>

          {/* Smart Features */}
          <section className="section-vertical">
            <div className="smart-row">
              <div className="smart-intro">
                <p className="eyebrow">
                  Quietly working in the background
                </p>
                <h2>
                  Roxan's smart features, visible when you need them.
                </h2>
                <p>
                  The workspace now reflects only connected systems and real
                  signals. Empty states are intentional until you grant access
                  or record activity.
                </p>
              </div>
              <div className="smart-features">
                <div>
                  <Bluetooth size={18} />
                  <span>
                    <strong>Wearable integration</strong>
                    <small>Connect a compatible device to begin</small>
                  </span>
                </div>
                <div>
                  <Cloud size={18} />
                  <span>
                    <strong>Offline queue</strong>
                    <small>
                      {queuedSessions
                        ? `${queuedSessions} local session${queuedSessions === 1 ? "" : "s"}`
                        : "No pending sessions"}
                    </small>
                  </span>
                </div>
                <div>
                  <ShieldCheck size={18} />
                  <span>
                    <strong>Privacy first</strong>
                    <small>Only your authenticated account can sync</small>
                  </span>
                </div>
                <div>
                  <Settings2 size={18} />
                  <span>
                    <strong>Motion detection</strong>
                    <small>
                      {phoneSensors.state === "active"
                        ? "Active for this session"
                        : "Idle until permission"}
                    </small>
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="page-footer">
            <span>
              Roxan Personal Assistant · Personal signals, without invented
              numbers.
            </span>
            <span>
              <button onClick={() => goTo("History")}>History</button>
              <button
                onClick={() => goTo("Connected devices")}
              >
                Data controls
              </button>
            </span>
          </footer>

          {/* Goal Modal */}
          {goalDialogOpen && (
            <div
              className="modal-scrim"
              role="presentation"
              onMouseDown={() => setGoalDialogOpen(false)}
            >
              <section
                className="goal-modal"
                ref={goalModalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="goal-modal-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="modal-heading">
                  <div>
                    <p className="eyebrow">Today's focus</p>
                    <h2 id="goal-modal-title">Add a daily goal</h2>
                  </div>
                  <button
                    className="modal-close"
                    onClick={() => setGoalDialogOpen(false)}
                    aria-label="Close goal dialog"
                  >
                    ×
                  </button>
                </div>
                <form onSubmit={addGoal} className="goal-form">
                  <label>
                    What do you want to measure?
                    <select
                      value={goalMetric}
                      onChange={(event) =>
                        setGoalMetric(event.target.value as GoalMetric)
                      }
                    >
                      {Object.entries(goalLabels).map(([value, option]) => (
                        <option value={value} key={value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Target for today
                    <input
                      type="number"
                      min="0.25"
                      step="0.25"
                      value={goalTarget}
                      onChange={(event) =>
                        setGoalTarget(Number(event.target.value))
                      }
                    />
                    <small>
                      Progress updates from sensor or synced data. Nothing is
                      pre-filled as completed.
                    </small>
                  </label>
                  <button className="modal-submit" type="submit">
                    Save today's goal <ArrowUpRight size={15} />
                  </button>
                </form>
              </section>
            </div>
          )}

          {/* Task Modal */}
          {taskDialogOpen && (
            <div
              className="modal-scrim"
              role="presentation"
              onMouseDown={() => setTaskDialogOpen(false)}
            >
              <section
                className="goal-modal"
                ref={taskModalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="task-modal-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="modal-heading">
                  <div>
                    <p className="eyebrow">Today's focus</p>
                    <h2 id="task-modal-title">Add a personal task</h2>
                  </div>
                  <button
                    className="modal-close"
                    onClick={() => setTaskDialogOpen(false)}
                    aria-label="Close task dialog"
                  >
                    ×
                  </button>
                </div>
                <form onSubmit={addTask} className="goal-form">
                  <label>
                    Task title
                    <input
                      autoFocus
                      value={taskTitle}
                      onChange={(event) => setTaskTitle(event.target.value)}
                      placeholder="e.g. Walk after lunch"
                      required
                    />
                  </label>
                  <label>
                    Note <span className="optional-label">optional</span>
                    <textarea
                      value={taskNote}
                      onChange={(event) => setTaskNote(event.target.value)}
                      placeholder="Add a small reminder"
                      rows={3}
                    />
                  </label>
                  <button className="modal-submit" type="submit">
                    Add today's task <ArrowUpRight size={15} />
                  </button>
                </form>
              </section>
            </div>
          )}

          {/* Login Modal */}
          <LoginModal
            isOpen={showLoginModal}
            onClose={() => {
              console.log("Closing login modal");
              setShowLoginModal(false);
            }}
            onLogin={(name) => {
              console.log("Login with name:", name);
              handleLogin(name);
            }}
            isLoading={loading}
          />

          {/* Weight Prompt Modal */}
          <WeightPromptModal
            isOpen={showWeightPrompt}
            onClose={() => {
              setShowWeightPrompt(false);
              setSessionData(null);
            }}
            onSave={async (weight) => {
              if (!sessionData) {
                return;
              }

              const baseCalories = Number(sessionData.calories) || 0;

              const actualCalories = Math.max(
                0,
                Math.round(baseCalories * (weight / 70)),
              );

              const finalSession = {
                ...sessionData,
                calories: actualCalories,
              };

              console.log("Weight saved:", weight);
              console.log("Final session:", finalSession);

              /*
               * IMPORTANT:
               * Queue/sync ONLY after weight is saved.
               *
               * ✅ Fixed: if online sync fails, queue locally so
               * the session is not lost.
               */
              let synced = false;
              if (phoneSensors.isOnline && isAuthenticated) {
                synced = await syncSessionWithWeight(
                  finalSession,
                  actualCalories,
                );
              }

              if (!synced) {
                queueSensorSession(finalSession);
                setQueuedSessions(readQueuedSessions().length);
                console.log(
                  "Session queued locally:",
                  finalSession.externalId,
                );
              }

              setShowWeightPrompt(false);
              setSessionData(null);

              alert(`You burned approximately ${actualCalories} kcal.`);
            }}
            calories={sessionData?.calories ?? null}
            steps={sessionData?.steps ?? 0}
            distance={sessionData?.distanceMeters ?? 0}
          />
        </div>
      </main>

      {/* Mobile Backdrop */}
      {showMobileNav && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setShowMobileNav(false)}
        />
      )}
    </div>
  );
}