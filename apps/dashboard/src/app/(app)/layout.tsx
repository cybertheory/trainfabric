import { SiteHeader } from "@/components/site-header";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
