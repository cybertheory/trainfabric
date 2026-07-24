"use client";

import dynamic from "next/dynamic";
import { isClerkClientEnabled } from "@/lib/clerk";
import { SocialFeedHome } from "@/components/social-feed";

const HomeWithClerk = dynamic(() => import("./home-with-clerk"), {
  ssr: false,
  loading: () => <SocialFeedHome />,
});

export default function HomePage() {
  if (isClerkClientEnabled()) return <HomeWithClerk />;
  return <SocialFeedHome />;
}
