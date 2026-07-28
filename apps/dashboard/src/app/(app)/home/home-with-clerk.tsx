"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { SocialFeedHome } from "@/components/social-feed";
import { isClerkClientEnabled } from "@/lib/clerk";

export default function HomeWithClerk() {
  if (!isClerkClientEnabled()) {
    return <SocialFeedHome />;
  }
  return <HomeAuthed />;
}

function HomeAuthed() {
  const { getToken, isSignedIn } = useAuth();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setToken(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void getToken().then((t) => {
        if (!cancelled) setToken(t ?? null);
      });
    };
    refresh();
    const iv = window.setInterval(refresh, 50_000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [getToken, isSignedIn]);

  return (
    <SocialFeedHome
      token={token}
      getToken={async () => (await getToken()) ?? null}
    />
  );
}
