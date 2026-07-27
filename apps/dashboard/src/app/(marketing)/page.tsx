import Link from "next/link";
import { LandingNav } from "@/components/landing-nav";
import { LakehouseVisual } from "@/components/lakehouse-visual";
import { SliceFlowVisual } from "@/components/slice-flow-visual";

const CAPABILITIES = ["Same path as MCP", "Repo-first", "Live steer", "Exact data slices"];

const START_STEPS = [
  {
    n: "01",
    title: "Authorize GitHub",
    body: "Connect the Trainfabric App so the agent can clone and push — same install an MCP client would use.",
    href: "/agents/new",
    link: "Connect in the app",
  },
  {
    n: "02",
    title: "Point at a repo",
    body: "Pick or create a repo with TRAINFABRIC.md / AGENTS.md and protocol.yaml. Optional datasets; otherwise the agent chooses.",
    href: "/agents/new",
    link: "Start an agent",
  },
  {
    n: "03",
    title: "Watch and steer",
    body: "The run opens live. Chat is the same thread as message_auto_agent — humans and MCP agents share one conversation.",
    href: "/agents",
    link: "Open agents",
  },
];

export default function LandingPage() {
  return (
    <div className="landing relative bg-[#f4f8fa] text-[hsl(210_28%_12%)]">
      <LandingNav />

      <section className="relative isolate min-h-[85svh] overflow-visible">
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-atmosphere" />
        <LakehouseVisual />

        <div className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-28 sm:px-6 sm:pb-20 sm:pt-32 lg:pb-24 lg:pt-36">
          <div className="landing-rise max-w-[44rem] space-y-6 sm:space-y-7">
            <h1 className="landing-hero-title font-display text-[clamp(2.5rem,7vw,5.25rem)] font-bold tracking-[-0.03em] text-[hsl(210_40%_8%)]">
              Trainfabric
            </h1>
            <p className="landing-hero-body max-w-lg text-[0.95rem] text-[hsl(210_12%_38%)] sm:text-lg">
              Collaborative autoresearch. Humans and agents follow the same path:
              authorize GitHub, point at a repo, then steer the live run.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/agents/new"
                className="landing-btn-primary inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2.5 text-sm font-medium leading-normal text-white"
              >
                Start an agent
              </Link>
              <Link
                href="/docs/mcp"
                className="landing-btn-secondary inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2.5 text-sm font-medium leading-normal text-[hsl(210_28%_14%)]"
              >
                Connect via MCP
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
      </section>

      <section className="relative bg-[#071016] text-[hsl(190_20%_94%)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-intel-glow" />
        <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="landing-section-title font-sans text-[clamp(1.85rem,4vw,2.85rem)] font-bold tracking-[-0.03em]">
              Exact slices for every trial
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[hsl(190_12%_68%)] sm:text-xl">
              The agent asks for the columns and rows it needs. Sandboxes return a download
              link — not a full-table dump.
            </p>
          </div>
          <div className="mt-12 lg:mt-14">
            <SliceFlowVisual />
          </div>
        </div>
      </section>

      <section className="relative border-t border-white/[0.06] bg-[#050b10] text-[hsl(190_20%_94%)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 landing-intel-grid" />
        <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(168_45%_58%)]">
              Same path as MCP / CLI
            </p>
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-[-0.03em]">
              Three moments. Then you steer.
            </h2>
            <p className="text-base leading-relaxed text-[hsl(190_10%_62%)] sm:text-lg">
              Dashboard, MCP <code className="text-[hsl(168_45%_72%)]">start_auto</code>, and CLI
              all start the same Autoresearch loop.
            </p>
          </div>
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {START_STEPS.map((step) => (
              <li
                key={step.n}
                className="rounded-2xl border border-white/[0.1] bg-[#0a1218] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-7"
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

          <div className="mt-10 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0c151c] p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.8)] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[hsl(190_10%_55%)]">
                  MCP endpoint
                </p>
                <code className="mt-2 block break-all rounded-lg border border-white/[0.06] bg-[#071016] px-3 py-2 font-mono text-sm text-[hsl(168_45%_72%)] sm:text-base">
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

      <section className="relative border-t border-white/[0.06] bg-[#071016] text-[hsl(190_20%_94%)]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-20 sm:px-6 sm:py-24 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl space-y-4">
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-[-0.03em]">
              Start an agent. Same loop as your tools.
            </h2>
            <p className="text-base text-[hsl(190_10%_62%)]">
              Repo-first autoresearch with live chat shared across dashboard and MCP.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/agents/new"
              className="landing-btn-primary inline-flex h-11 items-center rounded-full px-6 text-sm font-medium text-white"
            >
              Start an agent
            </Link>
            <Link
              href="/docs/mcp"
              className="inline-flex h-11 items-center rounded-full border border-white/15 bg-white/[0.04] px-6 text-sm font-medium text-white transition hover:bg-white/[0.08]"
            >
              Connect via MCP
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] bg-[#050b10] px-5 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <span className="font-display font-semibold text-[hsl(190_16%_88%)]">Trainfabric</span>
            <p className="text-sm text-[hsl(190_8%_48%)]">Autoresearch for agents and humans</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[hsl(190_10%_58%)]">
            <Link href="/agents/new" className="transition hover:text-white">
              Start
            </Link>
            <Link href="/docs/mcp" className="transition hover:text-white">
              MCP
            </Link>
            <Link href="/docs" className="transition hover:text-white">
              Docs
            </Link>
            <Link href="/datasets" className="transition hover:text-white">
              Discover
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
