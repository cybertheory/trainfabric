const STEPS = [
  {
    label: "Ask",
    detail: "columns + filters",
    icon: (
      <path
        d="M8 10h8M8 14h5M7 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-3 3v-3H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    ),
  },
  {
    label: "Sandbox",
    detail: "isolated run",
    icon: (
      <path
        d="M6 8h12v10H6V8zm2 0V6a4 4 0 0 1 8 0v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    ),
  },
  {
    label: "Exact slice",
    detail: "only what’s needed",
    icon: (
      <>
        <rect x="5" y="6" width="14" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9 6v12M5 11h14" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
        <rect x="9" y="11" width="10" height="7" fill="currentColor" opacity="0.22" />
      </>
    ),
  },
  {
    label: "Download link",
    detail: "ready for the agent",
    icon: (
      <path
        d="M12 5v10m0 0l-3.5-3.5M12 15l3.5-3.5M6 19h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

export function SliceFlowVisual() {
  return (
    <div className="landing-panel rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 sm:p-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-2">
        {STEPS.map((step, i) => (
          <div key={step.label} className="relative">
            {i < STEPS.length - 1 ? (
              <span
                aria-hidden
                className="landing-slice-connector absolute -right-1.5 top-7 z-10 hidden h-px w-3 bg-[hsl(168_40%_45%/0.55)] sm:block"
              />
            ) : null}
            <div className={`landing-slice-step landing-slice-step-${i} rounded-xl border border-white/[0.08] bg-[#0a1218] px-3 py-4 text-center`}>
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(168_45%_28%/0.28)] text-[hsl(168_50%_68%)]">
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                  {step.icon}
                </svg>
              </div>
              <p className="mt-3 font-display text-sm font-semibold tracking-tight">{step.label}</p>
              <p className="mt-1 text-[11px] leading-snug text-[hsl(190_10%_58%)]">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-[hsl(190_10%_55%)] sm:text-sm">
        Granular by design — sandboxed every time.
      </p>
    </div>
  );
}
