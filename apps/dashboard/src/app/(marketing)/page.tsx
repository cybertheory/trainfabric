import Link from "next/link";
import { LandingNav } from "@/components/landing-nav";
import { LakehouseVisual } from "@/components/lakehouse-visual";
import { SliceFlowVisual } from "@/components/slice-flow-visual";

const START_STEPS = [
  {
    n: "01",
    title: "Publish or discover data",
    body: "Drop in a dataset — or browse what’s already shared. Agents and humans use the same catalog.",
    href: "/datasets",
    link: "Explore datasets",
  },
  {
    n: "02",
    title: "Launch an autoresearch run",
    body: "Point at a repo and goal. Trainfabric provisions sandbox, data slices, and GPU trials for you.",
    href: "/agents/new",
    link: "Start a run",
  },
  {
    n: "03",
    title: "Steer while it works",
    body: "The agent keeps iterating for hours or days. You nudge when needed — no babysitting jobs.",
    href: "/agents",
    link: "See agents",
  },
];

const OUTCOMES = [
  {
    title: "Lightweight data, exact slices",
    body: "What you need is what you get. Agents ask for columns and rows; sandboxes return a download link — never a full-table dump.",
  },
  {
    title: "Managed GPU autoresearch",
    body: "Spin long-running trial loops without owning cluster glue. Budget, keep/discard, and score — Trainfabric runs the infra.",
  },
  {
    title: "Agent infra that stays up",
    body: "Durable sandboxes, shared ground truth, and live steer. Built for teams shipping autoresearch, not demo scripts.",
  },
];

const DOORS = [
  {
    title: "Private for your lab",
    body: "Internal data + agent infra in one place. Your autoresearch agents share one copy of the truth — no duplicated dumps.",
    points: [
      "Keep datasets private when you need to",
      "Same path for humans and agents",
      "No per-teammate pipeline tax",
    ],
  },
  {
    title: "Public when you want reach",
    body: "Publish once. Other agents find it, pull exact slices, and build on the same source — without emailing CSVs.",
    points: [
      "Discoverable catalog",
      "Share slices, not whole files",
      "Collaborate without redistributing dumps",
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="landing relative bg-[#f4f8fa] text-[hsl(210_28%_12%)]">
      <LandingNav />

      {/* Hero — brand + one outcome promise */}
      <section className="relative isolate min-h-[85svh] overflow-visible">
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-atmosphere" />
        <LakehouseVisual />

        <div className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-28 sm:px-6 sm:pb-20 sm:pt-32 lg:pb-24 lg:pt-36">
          <div className="landing-rise max-w-[46rem] space-y-6 sm:space-y-7">
            <h1 className="landing-hero-title font-display text-[clamp(2.5rem,7vw,5.25rem)] font-bold tracking-[-0.03em] text-[hsl(210_40%_8%)]">
              Trainfabric
            </h1>
            <p className="font-display text-[clamp(1.45rem,3.4vw,2.35rem)] font-semibold leading-[1.2] tracking-[-0.025em] text-[hsl(210_32%_14%)]">
              What you need is what you get.
            </p>
            <p className="landing-hero-body max-w-xl text-[0.95rem] text-[hsl(210_12%_38%)] sm:text-lg">
              The agentic data lakehouse for autoresearch — exact data slices,
              managed GPU trials, and long-running agents without heavy infra.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/agents/new"
                className="landing-btn-primary inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2.5 text-sm font-medium leading-normal text-white"
              >
                Start autoresearch
              </Link>
              <Link
                href="/datasets"
                className="landing-btn-secondary inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2.5 text-sm font-medium leading-normal text-[hsl(210_28%_14%)]"
              >
                Explore datasets
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Agentic lakehouse + exact slices */}
      <section className="relative bg-[#071016] text-[hsl(190_20%_94%)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-intel-glow" />
        <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="landing-section-title font-sans text-[clamp(1.85rem,4vw,2.85rem)] font-bold tracking-[-0.03em]">
              <span>The Agentic Data Lakehouse</span>
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[hsl(190_12%_68%)] sm:text-xl">
              Autoresearch agents ask for the slice they need. Sandboxes pull only
              those columns and rows — then hand back a download link. No full-table
              dumps. No warehouse tax.
            </p>
          </div>
          <div className="mt-12 lg:mt-14">
            <SliceFlowVisual />
          </div>
        </div>
      </section>

      {/* Managed autoresearch */}
      <section className="relative border-t border-white/[0.06] bg-[#050b10] text-[hsl(190_20%_94%)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-intel-grid" />
        <div className="relative mx-auto max-w-6xl px-5 py-24 sm:px-6 sm:py-28 md:py-32">
          <div className="landing-panel rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 backdrop-blur-sm sm:p-10 md:p-14">
            <div className="grid gap-10 md:grid-cols-[1.15fr_0.85fr] md:items-end md:gap-16">
              <div className="space-y-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
                  Long-running, managed
                </p>
                <h2 className="landing-section-title font-display text-[clamp(2rem,5vw,3.5rem)] font-semibold tracking-[-0.03em]">
                  <span>Autoresearch agents that keep going</span>
                </h2>
                <p className="max-w-md text-lg leading-relaxed text-[hsl(190_14%_68%)] sm:text-xl">
                  Ship lab-grade loops without standing up data, GPU, and agent
                  infrastructure yourself.
                </p>
              </div>
              <div className="space-y-6 border-t border-white/[0.08] pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-10">
                <p className="text-[0.95rem] leading-relaxed text-[hsl(190_10%_62%)] sm:text-base">
                  Durable sandboxes. Exact slices on every trial. Managed GPU
                  when you need compute. Steer live when a human should intervene —
                  then let the agent run.
                </p>
                <Link
                  href="/agents/new"
                  className="group inline-flex items-center gap-2 text-sm font-medium text-[hsl(168_55%_62%)] transition hover:text-[hsl(168_55%_72%)]"
                >
                  Launch a managed run
                  <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Outcomes for ICP */}
      <section className="relative border-t border-white/[0.06] bg-[#071016] text-[hsl(190_20%_94%)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
              Built for autoresearch teams
            </p>
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-[-0.03em]">
              Easy data. Easy GPU. Easy agent infra.
            </h2>
            <p className="text-base leading-relaxed text-[hsl(190_10%_62%)] sm:text-lg">
              Everything you need to iterate models against real datasets — without
              assembling a platform first.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {OUTCOMES.map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 sm:p-7"
              >
                <h3 className="font-display text-lg font-semibold tracking-tight">{card.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[hsl(190_10%_62%)]">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Private + public */}
      <section className="relative border-t border-white/[0.06] bg-[#050b10] text-[hsl(190_20%_94%)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
              One place, two modes
            </p>
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-[-0.03em]">
              Private lab or public network
            </h2>
            <p className="text-base leading-relaxed text-[hsl(190_10%_62%)] sm:text-lg">
              Keep workloads locked to your team, or publish when you want others
              to build on the same ground truth. Same product either way.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {DOORS.map((door) => (
              <div
                key={door.title}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 sm:p-8"
              >
                <h3 className="font-display text-xl font-semibold tracking-tight">{door.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[hsl(190_10%_62%)]">{door.body}</p>
                <ul className="mt-5 space-y-2.5">
                  {door.points.map((p) => (
                    <li key={p} className="flex gap-2 text-sm text-[hsl(190_14%_72%)]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(168_55%_52%)]" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Start */}
      <section className="relative border-t border-white/[0.06] bg-[#071016] text-[hsl(190_20%_94%)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
              Get started
            </p>
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-[-0.03em]">
              From dataset to running agent in minutes
            </h2>
          </div>
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {START_STEPS.map((step) => (
              <li
                key={step.n}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 sm:p-7"
              >
                <span className="font-mono text-xs text-[hsl(168_45%_58%)]">{step.n}</span>
                <h3 className="mt-3 font-display text-lg font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[hsl(190_10%_62%)]">{step.body}</p>
                <Link
                  href={step.href}
                  className="mt-5 inline-flex text-sm font-medium text-[hsl(168_55%_62%)] transition hover:text-[hsl(168_55%_72%)]"
                >
                  {step.link} →
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative border-t border-white/[0.06] bg-[#050b10] text-[hsl(190_20%_94%)]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-20 sm:px-6 sm:py-24 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl space-y-4">
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-[-0.03em]">
              Stop assembling infra. Start getting results.
            </h2>
            <p className="text-base text-[hsl(190_10%_62%)]">
              Exact slices. Managed GPU. Long-running autoresearch agents — ready
              when you are.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/agents/new"
              className="landing-btn-primary inline-flex h-11 items-center rounded-full px-6 text-sm font-medium text-white"
            >
              Start autoresearch
            </Link>
            <Link
              href="/datasets"
              className="inline-flex h-11 items-center rounded-full border border-white/15 bg-white/[0.04] px-6 text-sm font-medium text-white transition hover:bg-white/[0.08]"
            >
              Explore datasets
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] bg-[#050b10] px-5 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <span className="font-display font-semibold text-[hsl(190_16%_88%)]">Trainfabric</span>
            <p className="text-sm text-[hsl(190_8%_48%)]">
              Agentic data lakehouse for autoresearch
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[hsl(190_10%_58%)]">
            <Link href="/agents/new" className="transition hover:text-white">
              Start
            </Link>
            <Link href="/datasets" className="transition hover:text-white">
              Datasets
            </Link>
            <Link href="/docs" className="transition hover:text-white">
              Docs
            </Link>
            <Link href="/docs/mcp" className="transition hover:text-white">
              MCP
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
