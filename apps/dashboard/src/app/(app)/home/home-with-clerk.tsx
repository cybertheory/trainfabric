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
    void getToken().then((t) => setToken(t ?? null));
  }, [getToken, isSignedIn]);

  return <SocialFeedHome token={token} />;
}
