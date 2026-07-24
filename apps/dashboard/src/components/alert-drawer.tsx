"use client";

import Link from "next/link";
import { Bell, CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useJobTracker } from "@/lib/job-tracker";
import { cn } from "@/lib/utils";

export function JobProgressChip() {
  const { activeJobs, unreadCount, setDrawerOpen } = useJobTracker();
  const primary = activeJobs[0];

  if (!primary && unreadCount === 0) return null;

  return (
    <button
      type="button"
      onClick={() => setDrawerOpen(true)}
      className={cn(
        "hidden items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors sm:flex",
        primary
          ? "border-primary/30 bg-primary/10 text-foreground hover:bg-primary/15"
          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
      )}
      aria-label="Open job alerts"
    >
      {primary ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="max-w-[9rem] truncate">
            {primary.name} · {Math.round(primary.progress)}%
          </span>
        </>
      ) : (
        <>
          <Bell className="h-3.5 w-3.5" />
          <span>Alerts</span>
        </>
      )}
      {unreadCount > 0 ? (
        <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">
          {unreadCount}
        </Badge>
      ) : null}
    </button>
  );
}

export function AlertBellButton() {
  const { unreadCount, setDrawerOpen, activeJobs } = useJobTracker();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="relative h-8 w-8 px-0"
      onClick={() => setDrawerOpen(true)}
      aria-label="Notifications"
    >
      {activeJobs.length ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : (
        <Bell className="h-4 w-4" />
      )}
      {unreadCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </Button>
  );
}

export function AlertDrawer() {
  const {
    drawerOpen,
    setDrawerOpen,
    alerts,
    activeJobs,
    jobs,
    markAlertRead,
    markAllAlertsRead,
    dismissAlert,
    clearFinishedJobs,
    authToken,
  } = useJobTracker();

  const recentJobs = jobs.slice(0, 8);

  async function onMarkRead(id: string) {
    markAlertRead(id);
    const { markServerNotificationRead } = await import("@/components/notification-auth-bridge");
    await markServerNotificationRead(authToken, id);
  }

  async function onMarkAll() {
    markAllAlertsRead();
    const { markAllServerNotificationsRead } = await import("@/components/notification-auth-bridge");
    await markAllServerNotificationsRead(authToken);
  }

  return (
    <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-xl outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          )}
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <DialogPrimitive.Title className="text-sm font-semibold">
                Notifications
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-muted-foreground">
                Jobs, community updates, and alerts — monitor from anywhere.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto p-4">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  In progress
                </h3>
                {activeJobs.length === 0 ? (
                  <span className="text-xs text-muted-foreground">None</span>
                ) : null}
              </div>
              {activeJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No running ingest jobs.</p>
              ) : (
                <ul className="space-y-3">
                  {activeJobs.map((j) => (
                    <li key={j.jobId} className="rounded-lg border border-border/80 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{j.name}</p>
                        <Badge variant="outline">{j.status}</Badge>
                      </div>
                      <Progress value={j.progress} className="h-1.5" />
                      <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">{j.jobId}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Alerts
                </h3>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void onMarkAll()}>
                  Mark all read
                </Button>
              </div>
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No alerts yet.</p>
              ) : (
                <ul className="space-y-2">
                  {alerts.map((a) => (
                    <li
                      key={a.id}
                      className={cn(
                        "rounded-lg border px-3 py-2.5",
                        a.read ? "border-border/60 bg-transparent" : "border-primary/25 bg-primary/5",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {a.kind === "success" ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        ) : a.kind === "error" ? (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        ) : (
                          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{a.title}</p>
                          <p className="text-xs text-muted-foreground">{a.body}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {a.href ? (
                              <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                                <Link href={a.href} onClick={() => void onMarkRead(a.id)}>
                                  Open
                                </Link>
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                void onMarkRead(a.id);
                                dismissAlert(a.id);
                              }}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {recentJobs.length ? (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Recent jobs
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={clearFinishedJobs}
                  >
                    Clear finished
                  </Button>
                </div>
                <ul className="space-y-1.5">
                  {recentJobs.map((j) => (
                    <li
                      key={j.jobId}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-xs"
                    >
                      <span className="truncate">{j.name}</span>
                      <Badge variant="outline">{j.status}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
