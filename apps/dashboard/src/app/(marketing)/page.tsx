import Link from "next/link";
import { LandingNav } from "@/components/landing-nav";
import { LakehouseVisual } from "@/components/lakehouse-visual";

const CAPABILITIES = ["Iceberg tables", "Exact slices", "Forever cache", "Multiplayer agents"];

export default function LandingPage() {
  return (
    <div className="landing relative overflow-x-hidden bg-[#f4f8fa] text-[hsl(210_28%_12%)]">
      <LandingNav />

      <section className="relative isolate min-h-[100svh] overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-atmosphere" />
        <LakehouseVisual />

        <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col px-5 pt-28 pb-28 sm:px-6 sm:pt-32 lg:pt-36">
          <div className="landing-rise my-auto max-w-[40rem] space-y-6 sm:space-y-7">
            <p className="font-display text-[clamp(2.75rem,8vw,5.75rem)] font-bold leading-[0.95] tracking-[-0.04em] text-[hsl(210_40%_8%)]">
              Trainfabric
            </p>
            <h1 className="max-w-xl font-display text-[clamp(1.35rem,3.2vw,2.15rem)] font-semibold leading-[1.2] tracking-[-0.02em] text-[hsl(210_22%_22%)]">
              The Agentic Multiplayer Data Lakehouse
            </h1>
            <p className="max-w-md text-[0.95rem] leading-relaxed text-[hsl(210_12%_38%)] sm:text-lg sm:leading-relaxed">
              Agents can now effortlessly share and query data for analysis and
              autoresearch.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/datasets"
                className="landing-btn-primary inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-medium text-white"
              >
                Explore datasets
              </Link>
              <Link
                href="/new"
                className="landing-btn-secondary inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-medium text-[hsl(210_28%_14%)]"
              >
                Publish data
              </Link>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 pt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(210_10%_46%)] sm:text-xs">
              {CAPABILITIES.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-[hsl(168_50%_36%)]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-40 bg-gradient-to-b from-transparent via-[#f4f8fa]/60 to-[#071016]"
        />
      </section>

      <section className="relative bg-[#071016] text-[hsl(190_20%_94%)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-intel-glow" />
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-intel-grid" />

        <div className="relative mx-auto max-w-6xl px-5 py-24 sm:px-6 sm:py-28 md:py-32">
          <div className="landing-panel rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 backdrop-blur-sm sm:p-10 md:p-14">
            <div className="grid gap-10 md:grid-cols-[1.15fr_0.85fr] md:items-end md:gap-16">
              <div className="space-y-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
                  Built for agents
                </p>
                <h2 className="font-display text-[clamp(2rem,5vw,3.75rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
                  Democratizing access to intelligence
                </h2>
                <p className="max-w-md text-lg leading-relaxed text-[hsl(190_14%_68%)] sm:text-xl">
                  Now anyone with agents can solve problems like an AI lab
                </p>
              </div>
              <div className="space-y-6 border-t border-white/[0.08] pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-10">
                <p className="text-[0.95rem] leading-relaxed text-[hsl(190_10%_62%)] sm:text-base">
                  Shared Iceberg tables. Exact slice queries. Cache that lasts.
                  Multiplayer by default — so agents collaborate on the same
                  ground truth instead of reinventing every pipeline.
                </p>
                <Link
                  href="/datasets"
                  className="group inline-flex items-center gap-2 text-sm font-medium text-[hsl(168_55%_62%)] transition hover:text-[hsl(168_55%_72%)]"
                >
                  Start from public datasets
                  <span
                    aria-hidden
                    className="transition-transform group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] bg-[#050b10] px-5 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-sm text-[hsl(190_8%_48%)]">
          <span className="font-display font-semibold text-[hsl(190_16%_88%)]">
            Trainfabric
          </span>
          <span>Agent-native data lakehouse</span>
        </div>
      </footer>
    </div>
  );
}
