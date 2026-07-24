import Link from "next/link";
import { LandingNav } from "@/components/landing-nav";
import { LakehouseVisual } from "@/components/lakehouse-visual";
import { SliceFlowVisual } from "@/components/slice-flow-visual";

const CAPABILITIES = ["Easiest sharing", "Basically free", "Exact results", "Agent-native"];

const START_STEPS = [
  {
    n: "01",
    title: "Connect your agent",
    body: "Paste one MCP URL. Tools show up. No warehouse setup.",
    href: "/docs/mcp",
    link: "MCP setup",
  },
  {
    n: "02",
    title: "Share or discover",
    body: "Publish private data for your team, or browse what’s already public.",
    href: "/datasets",
    link: "Browse datasets",
  },
  {
    n: "03",
    title: "Ask for exactly what you need",
    body: "Agents request a slice. They get a download link — nothing more.",
    href: "/docs/quickstart",
    link: "Quickstart",
  },
];

const DOORS = [
  {
    title: "Private for your team",
    body: "Use Trainfabric as internal infra. Your agents share one copy of the truth — no duplicated dumps floating around.",
    points: ["Keep datasets private when you need to", "Same agent tools for everyone", "No per-teammate pipeline tax"],
  },
  {
    title: "Public when you want reach",
    body: "Publish once. Other agents and humans find it, ask for slices, and build on the same source.",
    points: ["Discoverable catalog", "Share slices, not whole files", "Collaborate without emailing CSVs"],
  },
];

export default function LandingPage() {
  return (
    <div className="landing relative overflow-x-hidden bg-[#f4f8fa] text-[hsl(210_28%_12%)]">
      <LandingNav />

      {/* Hero */}
      <section className="relative isolate min-h-[100svh] overflow-x-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-atmosphere" />
        <LakehouseVisual />

        <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col px-5 pt-28 pb-28 sm:px-6 sm:pt-32 lg:pt-36">
          <div className="landing-rise my-auto max-w-[44rem] space-y-6 sm:space-y-7">
            <h1 className="font-display text-[clamp(2.5rem,7vw,5.25rem)] font-bold leading-[1.08] tracking-[-0.035em] text-[hsl(210_40%_8%)]">
              The Agentic Multiplayer Data Lakehouse
            </h1>
            <p className="max-w-lg text-[0.95rem] leading-relaxed text-[hsl(210_12%_38%)] sm:text-lg sm:leading-relaxed">
              Agents and Developers can now effortlessly host, share, and query
              the exact data they need for faster workflows, analysis, and
              autoresearch. No matter the size.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/docs/agent-skill"
                className="landing-btn-primary inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-medium text-white"
              >
                Connect an agent
              </Link>
              <Link
                href="/datasets"
                className="landing-btn-secondary inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-medium text-[hsl(210_28%_14%)]"
              >
                Explore datasets
              </Link>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(210_10%_46%)] sm:text-xs">
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

      {/* Exact slice — near top */}
      <section className="relative bg-[#071016] text-[hsl(190_20%_94%)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-intel-glow" />
        <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-14">
            <div className="space-y-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
                What you need is what you get
              </p>
              <h2 className="font-display text-[clamp(1.85rem,4vw,2.85rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
                Agents ask as granular as they want
              </h2>
              <p className="max-w-md text-base leading-relaxed text-[hsl(190_12%_68%)] sm:text-lg">
                Every query runs in a sandbox. We pull only the columns and rows
                requested — then hand back a download link. No full-table dumps.
                No guessing.
              </p>
            </div>
            <SliceFlowVisual />
          </div>
        </div>
      </section>

      {/* Democratizing */}
      <section className="relative border-t border-white/[0.06] bg-[#050b10] text-[hsl(190_20%_94%)]">
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
                  Share once. Query precisely. Reuse forever. Multiplayer by
                  default — so agents work from the same ground truth instead of
                  reinventing every pipeline.
                </p>
                <Link
                  href="/docs"
                  className="group inline-flex items-center gap-2 text-sm font-medium text-[hsl(168_55%_62%)] transition hover:text-[hsl(168_55%_72%)]"
                >
                  Read the docs
                  <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Outcomes */}
      <section className="relative border-t border-white/[0.06] bg-[#071016] text-[hsl(190_20%_94%)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
              The pitch
            </p>
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-[-0.03em]">
              Easiest sharing. Basically free. Exact results.
            </h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Easiest data sharing",
                body: "Publish a dataset. Point agents at it. Humans and agents share the same place — private or public.",
              },
              {
                title: "Basically free",
                body: "Most use is browse + precise slices. You aren’t charged for hauling entire tables when you only need a cut.",
              },
              {
                title: "What you need is what you get",
                body: "Agents name the columns and filters. Sandboxes fetch that slice and return a link. Done.",
              },
            ].map((card) => (
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
              Internal infra and public sharing
            </h2>
            <p className="text-base leading-relaxed text-[hsl(190_10%_62%)] sm:text-lg">
              Keep workloads private for your agents, or publish when you want
              the network. Same product either way.
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
              Live with your agents in minutes
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

          <div className="mt-10 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a1218] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[hsl(190_10%_55%)]">
                  MCP endpoint
                </p>
                <code className="mt-2 block break-all font-mono text-sm text-[hsl(168_45%_72%)] sm:text-base">
                  https://trainfabric-router.rishabhspro.workers.dev/mcp
                </code>
              </div>
              <Link
                href="/docs/mcp"
                className="landing-btn-primary inline-flex h-10 items-center rounded-full px-5 text-sm font-medium text-white"
              >
                MCP docs
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative border-t border-white/[0.06] bg-[#050b10] text-[hsl(190_20%_94%)]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-20 sm:px-6 sm:py-24 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl space-y-4">
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-[-0.03em]">
              Start sharing. Let agents pull exact slices.
            </h2>
            <p className="text-base text-[hsl(190_10%_62%)]">
              Free for most users. Private for your team or public for the
              network.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/docs/agent-skill"
              className="landing-btn-primary inline-flex h-11 items-center rounded-full px-6 text-sm font-medium text-white"
            >
              Install agent skill
            </Link>
            <Link
              href="/new"
              className="inline-flex h-11 items-center rounded-full border border-white/15 bg-white/[0.04] px-6 text-sm font-medium text-white transition hover:bg-white/[0.08]"
            >
              Publish data
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] bg-[#050b10] px-5 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <span className="font-display font-semibold text-[hsl(190_16%_88%)]">Trainfabric</span>
            <p className="text-sm text-[hsl(190_8%_48%)]">Easiest data sharing for agents</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[hsl(190_10%_58%)]">
            <Link href="/docs" className="transition hover:text-white">
              Docs
            </Link>
            <Link href="/docs/mcp" className="transition hover:text-white">
              MCP
            </Link>
            <Link href="/docs/api" className="transition hover:text-white">
              API
            </Link>
            <Link href="/docs/agent-skill" className="transition hover:text-white">
              Agent Skill
            </Link>
            <Link href="/datasets" className="transition hover:text-white">
              Datasets
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
