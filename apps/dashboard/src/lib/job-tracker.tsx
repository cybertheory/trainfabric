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
  /** lakehouse ingest vs long-running AutoRun */
  kind?: "job" | "auto";
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
  trackAutoRun: (run: { autoRunId: string; datasetId?: string; name: string }) => void;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;
  dismissAlert: (id: string) => void;
  clearFinishedJobs: () => void;
  /** Merge server-backed social notifications into the activity feed. */
  mergeServerNotifications: (
    items: Array<{
      id: string;
      title: string;
      body: string;
      href?: string;
      createdAt: number;
      read: boolean;
    }>,
  ) => void;
  setAuthToken: (token: string | null) => void;
  authToken: string | null;
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

async function fetchAutoRun(
  autoRunId: string,
  token?: string | null,
): Promise<{
  status?: string;
  progress?: number;
  error?: string;
  datasetId?: string;
}> {
  const origin = publicApiOrigin();
  const res = await fetch(`${origin}/auto/${autoRunId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`auto ${res.status}`);
  const data = (await res.json()) as {
    run?: {
      status?: string;
      error?: string;
      datasetId?: string;
      progress?: { trial?: number; bestScore?: number };
      protocol?: { budget?: { maxTrials?: number } };
    };
  };
  const run = data.run;
  const trial = run?.progress?.trial ?? 0;
  const max = run?.protocol?.budget?.maxTrials ?? 1;
  const status = run?.status ?? "running";
  const progress =
    status === "done" || status === "cancelled"
      ? 100
      : Math.min(95, Math.round((trial / Math.max(max, 1)) * 100));
  return {
    status,
    progress,
    error: run?.error,
    datasetId: run?.datasetId,
  };
}

export function JobTrackerProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
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
          kind: "job",
        };
        return [next, ...prev.filter((j) => j.jobId !== job.jobId)];
      });
      pushAlert({
        title: "Ingest started",
        body: `${job.name} is uploading in the background.`,
        kind: "info",
        jobId: job.jobId,
        href: "/home",
      });
    },
    [pushAlert],
  );

  const trackAutoRun = useCallback(
    (run: { autoRunId: string; datasetId?: string; name: string }) => {
      const now = Date.now();
      setJobs((prev) => {
        const next: TrackedJob = {
          jobId: run.autoRunId,
          datasetId: run.datasetId,
          name: run.name,
          status: "provisioning",
          progress: 5,
          startedAt: now,
          updatedAt: now,
          alerted: false,
          kind: "auto",
        };
        return [next, ...prev.filter((j) => j.jobId !== run.autoRunId)];
      });
      pushAlert({
        title: "Autoresearch started",
        body: `${run.name} is provisioning.`,
        kind: "info",
        jobId: run.autoRunId,
        href: `/auto/${run.autoRunId}`,
      });
    },
    [pushAlert],
  );

  const activeCount = jobs.filter(
    (j) =>
      j.status === "pending" ||
      j.status === "running" ||
      j.status === "provisioning" ||
      j.status === "paused",
  ).length;

  useEffect(() => {
    if (!hydrated || activeCount === 0) return;
    let cancelled = false;

    async function poll() {
      const active = jobsRef.current.filter(
        (j) =>
          (j.status === "pending" ||
            j.status === "running" ||
            j.status === "provisioning" ||
            j.status === "paused") &&
          !j.alerted,
      );
      for (const job of active) {
        try {
          const remote =
            job.kind === "auto"
              ? await fetchAutoRun(job.jobId, authToken)
              : await fetchJob(job.jobId);
          if (cancelled) return;
          const status = remote.status ?? job.status;
          const progress =
            typeof remote.progress === "number"
              ? remote.progress
              : status === "done" || status === "cancelled"
                ? 100
                : status === "running" || status === "provisioning"
                  ? Math.max(job.progress, 35)
                  : job.progress;
          const terminal =
            status === "done" || status === "error" || status === "cancelled";

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
            const isAuto = job.kind === "auto";
            if (status === "done") {
              pushAlert({
                title: isAuto ? "Autoresearch complete" : "Ingest complete",
                body: isAuto ? `${job.name} finished its trial budget.` : `${job.name} is ready.`,
                kind: "success",
                jobId: job.jobId,
                href: isAuto ? `/auto/${job.jobId}` : "/home",
              });
            } else if (status === "cancelled") {
              pushAlert({
                title: "Autoresearch cancelled",
                body: `${job.name} was cancelled.`,
                kind: "info",
                jobId: job.jobId,
                href: `/auto/${job.jobId}`,
              });
            } else {
              pushAlert({
                title: isAuto ? "Autoresearch failed" : "Ingest failed",
                body: remote.error || `${job.name} failed.`,
                kind: "error",
                jobId: job.jobId,
                href: isAuto ? `/auto/${job.jobId}` : undefined,
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
  }, [hydrated, activeCount, pushAlert, authToken]);

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
    setJobs((prev) =>
      prev.filter(
        (j) =>
          j.status === "pending" ||
          j.status === "running" ||
          j.status === "provisioning" ||
          j.status === "paused",
      ),
    );
  }, []);

  const mergeServerNotifications = useCallback(
    (
      items: Array<{
        id: string;
        title: string;
        body: string;
        href?: string;
        createdAt: number;
        read: boolean;
      }>,
    ) => {
      if (!items.length) return;
      setAlerts((prev) => {
        const existing = new Set(prev.map((a) => a.id));
        const incoming: AlertItem[] = [];
        for (const n of items) {
          if (existing.has(n.id)) continue;
          incoming.push({
            id: n.id,
            title: n.title,
            body: n.body,
            kind: "info",
            href: n.href,
            createdAt: n.createdAt,
            read: n.read,
          });
        }
        if (!incoming.length) {
          // Sync read state for known ids
          const readMap = new Map(items.map((i) => [i.id, i.read]));
          return prev.map((a) =>
            readMap.has(a.id) ? { ...a, read: readMap.get(a.id)! } : a,
          );
        }
        return [...incoming, ...prev].sort((a, b) => b.createdAt - a.createdAt).slice(0, 80);
      });
    },
    [],
  );

  // Poll server notifications when authenticated
  useEffect(() => {
    if (!hydrated || !authToken) return;
    let cancelled = false;
    async function poll() {
      try {
        const origin = publicApiOrigin();
        const res = await fetch(`${origin}/notifications?limit=40`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          notifications?: Array<{
            id: string;
            title: string;
            body: string;
            href?: string;
            createdAt: number;
            read: boolean;
          }>;
        };
        if (data.notifications) mergeServerNotifications(data.notifications);
      } catch {
        /* ignore */
      }
    }
    void poll();
    const iv = window.setInterval(() => void poll(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [hydrated, authToken, mergeServerNotifications]);

  const activeJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.status === "pending" ||
          j.status === "running" ||
          j.status === "provisioning" ||
          j.status === "paused",
      ),
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
      trackAutoRun,
      markAlertRead,
      markAllAlertsRead,
      dismissAlert,
      clearFinishedJobs,
      mergeServerNotifications,
      setAuthToken,
      authToken,
    }),
    [
      jobs,
      alerts,
      unreadCount,
      activeJobs,
      drawerOpen,
      trackJob,
      trackAutoRun,
      markAlertRead,
      markAllAlertsRead,
      dismissAlert,
      clearFinishedJobs,
      mergeServerNotifications,
      authToken,
    ],
  );

  return <JobTrackerContext.Provider value={value}>{children}</JobTrackerContext.Provider>;
}

export function useJobTracker() {
  const ctx = useContext(JobTrackerContext);
  if (!ctx) throw new Error("useJobTracker must be used within JobTrackerProvider");
  return ctx;
}
