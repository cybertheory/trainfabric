"use client";

import { SignUp } from "@clerk/nextjs";

export function SignUpForm() {
  return (
    <SignUp
      routing="path"
      path="/sign-up"
      signInUrl="/sign-in"
      fallbackRedirectUrl="/home"
      forceRedirectUrl="/home"
    />
  );
}
