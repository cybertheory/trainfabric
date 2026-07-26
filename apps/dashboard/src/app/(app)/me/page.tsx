"use client";

import { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import type { DatasetConnection, DatasetMeta } from "@trainfabric/shared";
import { Database, Link2, Loader2 } from "lucide-react";
import { DatasetCard } from "@/components/dataset-card";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { isClerkClientEnabled } from "@/lib/clerk";

export default function MePage() {
  if (!isClerkClientEnabled()) return <ProfileContent token={null} />;
  return <AuthenticatedProfile />;
}

function AuthenticatedProfile() {
  const { getToken, isSignedIn } = useAuth();
  const { user } = useUser();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setToken(null);
      return;
    }
    void getToken().then((value) => setToken(value ?? null));
  }, [getToken, isSignedIn]);

  return (
    <ProfileContent
      token={token}
      profile={{
        name: user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? "Account",
        email: user?.primaryEmailAddress?.emailAddress ?? undefined,
        imageUrl: user?.imageUrl,
      }}
    />
  );
}

function ProfileContent({
  token,
  profile,
}: {
  token: string | null;
  profile?: { name: string; email?: string; imageUrl?: string };
}) {
  const [ownedDatasets, setOwnedDatasets] = useState<DatasetMeta[]>([]);
  const [connectedDatasets, setConnectedDatasets] = useState<DatasetMeta[]>([]);
  const [connections, setConnections] = useState<DatasetConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isClerkClientEnabled() && !token) return;
    setLoading(true);
    void Promise.all([
      apiFetch<{ datasets: DatasetMeta[] }>("/datasets?owner=me&limit=100", { token }),
      token
        ? apiFetch<{ connections: DatasetConnection[]; datasets: DatasetMeta[] }>(
            "/me/connections",
            { token },
          )
        : Promise.resolve({ connections: [], datasets: [] }),
    ])
      .then(([owned, connected]) => {
        setOwnedDatasets(owned.datasets ?? []);
        setConnections(connected.connections ?? []);
        setConnectedDatasets(connected.datasets ?? []);
      })
      .catch(() => {
        setOwnedDatasets([]);
        setConnections([]);
        setConnectedDatasets([]);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const connectionByDataset = new Map(
    connections.map((connection) => [connection.datasetId, connection]),
  );

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center gap-4 rounded-xl border bg-muted/20 p-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-lg font-medium">
          {profile?.imageUrl ? (
            // Clerk serves the authenticated user's avatar URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            profile?.name.slice(0, 2).toUpperCase() ?? "TF"
          )}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {profile?.name ?? "Your profile"}
          </h1>
          {profile?.email ? (
            <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="secondary">{ownedDatasets.length} owned</Badge>
            <Badge variant="secondary">{connectedDatasets.length} connected</Badge>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading profile datasets…
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Published datasets</h2>
        </div>
        <p className="text-sm text-muted-foreground">Public and private datasets owned by this account.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ownedDatasets.map((d) => (
            <DatasetCard key={d.id} dataset={d} />
          ))}
          {!loading && ownedDatasets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No datasets published yet.</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Connected datasets</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Dataset communities followed by this account. Their updates shape the Home feed.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {connectedDatasets.map((dataset) => {
            const connection = connectionByDataset.get(dataset.id);
            return (
              <div key={dataset.id} className="space-y-1.5">
                <DatasetCard dataset={dataset} />
                {connection ? (
                  <p className="px-1 text-xs text-muted-foreground">
                    Connected {new Date(connection.createdAt).toLocaleDateString()} via{" "}
                    {connection.source}
                  </p>
                ) : null}
              </div>
            );
          })}
          {!loading && connectedDatasets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No connections yet. Use the search on Home to find a dataset.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
