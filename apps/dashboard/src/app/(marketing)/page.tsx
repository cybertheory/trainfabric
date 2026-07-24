import Link from "next/link";
import { LandingNav } from "@/components/landing-nav";
import { LakehouseVisual } from "@/components/lakehouse-visual";

export default function LandingPage() {
  return (
    <div className="landing relative overflow-x-hidden bg-[hsl(195_28%_96%)] text-[hsl(210_28%_12%)]">
      <LandingNav />

      <section className="relative isolate min-h-[100svh] overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 landing-atmosphere"
        />
        <LakehouseVisual />

        <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-4 pb-16 pt-28 sm:pb-20 sm:pt-32 md:justify-center md:pb-24">
          <div className="landing-rise max-w-3xl space-y-7">
            <p className="font-display text-5xl font-bold tracking-tight text-[hsl(210_35%_10%)] sm:text-7xl md:text-8xl">
              Trainfabric
            </p>
            <h1 className="max-w-2xl font-display text-2xl font-semibold leading-tight tracking-tight text-[hsl(210_25%_18%)] sm:text-3xl md:text-4xl">
              The Agentic Multiplayer Data Lakehouse
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-[hsl(210_12%_34%)] sm:text-lg">
              Agents can now effortlessly share and query data for analysis and
              autoresearch.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/datasets"
                className="inline-flex h-11 items-center justify-center rounded-md bg-[hsl(168_55%_28%)] px-5 text-sm font-medium text-white transition hover:bg-[hsl(168_55%_24%)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(168_55%_28%)]"
              >
                Explore datasets
              </Link>
              <Link
                href="/new"
                className="inline-flex h-11 items-center justify-center rounded-md border border-[hsl(210_18%_72%)] bg-white/50 px-5 text-sm font-medium text-[hsl(210_28%_14%)] backdrop-blur-sm transition hover:border-[hsl(210_18%_55%)] hover:bg-white/80"
              >
                Publish data
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-t border-[hsl(195_18%_84%)] bg-[hsl(198_32%_12%)] text-[hsl(190_20%_94%)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 landing-intel-glow"
        />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-24 md:grid-cols-[1.1fr_0.9fr] md:items-end md:gap-16 md:py-32">
          <div className="space-y-5">
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
              Democratizing access to intelligence
            </h2>
            <p className="max-w-lg text-lg leading-relaxed text-[hsl(190_14%_72%)] sm:text-xl">
              Now anyone with agents can solve problems like an AI lab
            </p>
          </div>
          <div className="space-y-4 text-[hsl(190_12%_68%)]">
            <p className="text-base leading-relaxed sm:text-lg">
              Shared Iceberg tables. Exact slice queries. Cache that lasts.
              Multiplayer by default — so agents collaborate on the same ground
              truth instead of reinventing every pipeline.
            </p>
            <Link
              href="/datasets"
              className="inline-flex items-center gap-2 text-sm font-medium text-[hsl(168_55%_62%)] transition hover:text-[hsl(168_55%_72%)]"
            >
              Start from public datasets
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[hsl(195_18%_84%)] bg-[hsl(195_28%_96%)] px-4 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-sm text-[hsl(210_10%_42%)]">
          <span className="font-display font-semibold text-[hsl(210_28%_16%)]">
            Trainfabric
          </span>
          <span>Agent-native data lakehouse</span>
        </div>
      </footer>
    </div>
  );
}
