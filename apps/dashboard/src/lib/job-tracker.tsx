"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { publicApiOrigin } from "@/lib/api";

export type TrackedJob = {
  jobId: string;
  datasetId?: string;
  name: string;
  status: "pending" | "running" | "done" | "error" | string;
  progress: number;
  error?: string;
  startedAt: number;
  updatedAt: number;
  /** Set once a terminal alert has been emitted for this job. */
  alerted?: boolean;
};

export type AlertItem = {
  id: string;
  title: string;
  body: string;
  kind: "success" | "error" | "info";
  jobId?: string;
  href?: string;
  createdAt: number;
  read: boolean;
};

type JobTrackerValue = {
  jobs: TrackedJob[];
  alerts: AlertItem[];
  unreadCount: number;
  activeJobs: TrackedJob[];
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  trackJob: (job: { jobId: string; datasetId?: string; name: string }) => void;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;
  dismissAlert: (id: string) => void;
  clearFinishedJobs: () => void;
};

const JOBS_KEY = "tf_tracked_jobs";
const ALERTS_KEY = "tf_alerts";

const JobTrackerContext = createContext<JobTrackerValue | null>(null);

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

async function fetchJob(jobId: string): Promise<{
  status?: string;
  progress?: number;
  error?: string;
  datasetId?: string;
}> {
  const origin = publicApiOrigin();
  const res = await fetch(`${origin}/jobs/${jobId}`);
  if (!res.ok) throw new Error(`job ${res.status}`);
  return res.json();
}

export function JobTrackerProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    setJobs(readJson<TrackedJob[]>(JOBS_KEY, []));
    setAlerts(readJson<AlertItem[]>(ALERTS_KEY, []));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeJson(JOBS_KEY, jobs);
  }, [jobs, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeJson(ALERTS_KEY, alerts);
  }, [alerts, hydrated]);

  const pushAlert = useCallback((alert: Omit<AlertItem, "id" | "createdAt" | "read">) => {
    const item: AlertItem = {
      ...alert,
      id: `al_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      createdAt: Date.now(),
      read: false,
    };
    setAlerts((prev) => [item, ...prev].slice(0, 50));
    setDrawerOpen(true);
    if (alert.kind === "success") toast.success(alert.title, { description: alert.body });
    else if (alert.kind === "error") toast.error(alert.title, { description: alert.body });
    else toast.message(alert.title, { description: alert.body });
  }, []);

  const trackJob = useCallback(
    (job: { jobId: string; datasetId?: string; name: string }) => {
      const now = Date.now();
      setJobs((prev) => {
        const next: TrackedJob = {
          jobId: job.jobId,
          datasetId: job.datasetId,
          name: job.name,
          status: "pending",
          progress: 5,
          startedAt: now,
          updatedAt: now,
          alerted: false,
        };
        return [next, ...prev.filter((j) => j.jobId !== job.jobId)];
      });
      pushAlert({
        title: "Ingest started",
        body: `${job.name} is uploading in the background.`,
        kind: "info",
        jobId: job.jobId,
        href: "/datasets",
      });
    },
    [pushAlert],
  );

  const activeCount = jobs.filter((j) => j.status === "pending" || j.status === "running").length;

  useEffect(() => {
    if (!hydrated || activeCount === 0) return;
    let cancelled = false;

    async function poll() {
      const active = jobsRef.current.filter(
        (j) => (j.status === "pending" || j.status === "running") && !j.alerted,
      );
      for (const job of active) {
        try {
          const remote = await fetchJob(job.jobId);
          if (cancelled) return;
          const status = remote.status ?? job.status;
          const progress =
            typeof remote.progress === "number"
              ? remote.progress
              : status === "done"
                ? 100
                : status === "running"
                  ? Math.max(job.progress, 35)
                  : job.progress;
          const terminal = status === "done" || status === "error";

          setJobs((prev) =>
            prev.map((j) =>
              j.jobId === job.jobId
                ? {
                    ...j,
                    status,
                    progress,
                    error: remote.error,
                    datasetId: remote.datasetId ?? j.datasetId,
                    updatedAt: Date.now(),
                    alerted: terminal ? true : j.alerted,
                  }
                : j,
            ),
          );

          if (terminal && !job.alerted) {
            if (status === "done") {
              pushAlert({
                title: "Ingest complete",
                body: `${job.name} is ready.`,
                kind: "success",
                jobId: job.jobId,
                href: "/datasets",
              });
            } else {
              pushAlert({
                title: "Ingest failed",
                body: remote.error || `${job.name} failed.`,
                kind: "error",
                jobId: job.jobId,
              });
            }
          }
        } catch {
          /* keep polling */
        }
      }
    }

    void poll();
    const iv = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [hydrated, activeCount, pushAlert]);

  const markAlertRead = useCallback((id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
  }, []);

  const markAllAlertsRead = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearFinishedJobs = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status === "pending" || j.status === "running"));
  }, []);

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status === "pending" || j.status === "running"),
    [jobs],
  );

  const unreadCount = useMemo(() => alerts.filter((a) => !a.read).length, [alerts]);

  const value = useMemo<JobTrackerValue>(
    () => ({
      jobs,
      alerts,
      unreadCount,
      activeJobs,
      drawerOpen,
      setDrawerOpen,
      trackJob,
      markAlertRead,
      markAllAlertsRead,
      dismissAlert,
      clearFinishedJobs,
    }),
    [
      jobs,
      alerts,
      unreadCount,
      activeJobs,
      drawerOpen,
      trackJob,
      markAlertRead,
      markAllAlertsRead,
      dismissAlert,
      clearFinishedJobs,
    ],
  );

  return <JobTrackerContext.Provider value={value}>{children}</JobTrackerContext.Provider>;
}

export function useJobTracker() {
  const ctx = useContext(JobTrackerContext);
  if (!ctx) throw new Error("useJobTracker must be used within JobTrackerProvider");
  return ctx;
}
