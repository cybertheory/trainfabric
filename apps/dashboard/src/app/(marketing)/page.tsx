import Link from "next/link";
import { LandingNav } from "@/components/landing-nav";
import { LakehouseVisual } from "@/components/lakehouse-visual";

const CAPABILITIES = ["Iceberg tables", "Exact slices", "Forever cache", "Multiplayer agents"];

const START_STEPS = [
  {
    n: "01",
    title: "Point your agent at MCP",
    body: "Paste the MCP URL into Cursor, Claude, or any MCP client. Tools appear instantly.",
    href: "/docs/mcp",
    link: "MCP setup",
  },
  {
    n: "02",
    title: "Discover or publish",
    body: "Query public datasets, or publish a private table for your team’s agents only.",
    href: "/datasets",
    link: "Browse datasets",
  },
  {
    n: "03",
    title: "Query exact slices",
    body: "Agents request columns + filters. Aligned reads cost nothing; results cache forever.",
    href: "/docs/api",
    link: "API reference",
  },
];

const DOORS = [
  {
    title: "Private workloads",
    body: "Use Trainfabric as internal infra. Keep datasets private to your org, share them across your agents, and skip standing up another lakehouse.",
    points: ["Private visibility by default when you need it", "Same MCP + REST for every agent", "No duplicate pipelines per teammate"],
  },
  {
    title: "Public sharing",
    body: "Publish once. Other agents and humans discover, inspect, and query the same Iceberg ground truth — multiplayer by design.",
    points: ["Public catalog for discovery", "Exact slice queries, not full dumps", "Derived datasets with lineage"],
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
            <p className="max-w-md text-[0.95rem] leading-relaxed text-[hsl(210_12%_38%)] sm:text-lg sm:leading-relaxed">
              Agents can now effortlessly share and query data for analysis and
              autoresearch.
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
            <p className="text-sm text-[hsl(210_12%_42%)]">
              Free for most users · MCP in minutes · Private or public
            </p>
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

      {/* Democratizing */}
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

      {/* Why start now — ease, free, speed */}
      <section className="relative border-t border-white/[0.06] bg-[#050b10] text-[hsl(190_20%_94%)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
              Why teams start today
            </p>
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-[-0.03em]">
              Easy, affordable, and agent-ready in minutes
            </h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Free for most users",
                body: "Browse public data, connect agents, and run cache-friendly slice queries without standing up infra. Heavy compute is the exception — not the default bill.",
              },
              {
                title: "Minutes, not weeks",
                body: "One MCP URL or agent skill. No warehouse migration, no custom connectors per agent. Publish a dataset and query it from the same interface.",
              },
              {
                title: "Built for agent loops",
                body: "Discover → inspect → estimate → query. Tools are workflow-shaped so agents can research and analyze without human glue code.",
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
      <section className="relative border-t border-white/[0.06] bg-[#071016] text-[hsl(190_20%_94%)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
              One lakehouse, two modes
            </p>
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-[-0.03em]">
              Internal infra and public sharing — same fabric
            </h2>
            <p className="text-base leading-relaxed text-[hsl(190_10%_62%)] sm:text-lg">
              Run private workloads for your agents, publish when you want the
              network effect. Visibility is a property of the dataset, not a
              second product.
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

      {/* Start in 3 steps */}
      <section className="relative border-t border-white/[0.06] bg-[#050b10] text-[hsl(190_20%_94%)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
              Get started
            </p>
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-[-0.03em]">
              From zero to agent queries fast
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
      <section className="relative border-t border-white/[0.06] bg-[#071016] text-[hsl(190_20%_94%)]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-20 sm:px-6 sm:py-24 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl space-y-4">
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-[-0.03em]">
              Join the fabric. Share data. Ship agent research.
            </h2>
            <p className="text-base text-[hsl(190_10%_62%)]">
              Start free on public datasets, or publish private tables as your
              team’s internal lakehouse.
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
            <p className="text-sm text-[hsl(190_8%_48%)]">Agent-native data lakehouse</p>
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
