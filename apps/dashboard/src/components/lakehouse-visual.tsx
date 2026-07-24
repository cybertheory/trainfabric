export function LakehouseVisual() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="lake" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(195 45% 88%)" />
            <stop offset="45%" stopColor="hsl(178 35% 78%)" />
            <stop offset="100%" stopColor="hsl(205 40% 72%)" />
          </linearGradient>
          <linearGradient id="stream" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(168 50% 35%)" stopOpacity="0" />
            <stop offset="40%" stopColor="hsl(168 55% 32%)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="hsl(195 50% 40%)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(168 60% 45%)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="hsl(168 60% 45%)" stopOpacity="0" />
          </radialGradient>
          <filter id="soft">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>

        <rect width="1440" height="900" fill="url(#lake)" />

        {/* Depth bands — lake surface */}
        <g className="landing-ripple" opacity="0.35">
          <path
            d="M-40 520 C 220 470, 420 580, 720 530 S 1180 470, 1480 540"
            fill="none"
            stroke="hsl(210 30% 40%)"
            strokeWidth="1"
            opacity="0.25"
          />
          <path
            d="M-40 580 C 260 530, 480 640, 760 590 S 1220 520, 1480 600"
            fill="none"
            stroke="hsl(210 30% 40%)"
            strokeWidth="1"
            opacity="0.18"
          />
          <path
            d="M-40 640 C 240 600, 500 700, 800 650 S 1240 590, 1480 660"
            fill="none"
            stroke="hsl(210 30% 40%)"
            strokeWidth="1"
            opacity="0.12"
          />
        </g>

        {/* Shared query paths between agents */}
        <g stroke="url(#stream)" strokeWidth="2" fill="none" filter="url(#soft)">
          <path className="landing-stream landing-stream-a" d="M220 210 C 380 180, 520 320, 690 290" />
          <path className="landing-stream landing-stream-b" d="M690 290 C 860 250, 980 380, 1180 320" />
          <path className="landing-stream landing-stream-c" d="M360 420 C 520 360, 640 480, 820 440" />
          <path className="landing-stream landing-stream-d" d="M820 440 C 980 400, 1080 520, 1260 470" />
          <path className="landing-stream landing-stream-e" d="M280 620 C 460 560, 620 680, 840 610" />
        </g>

        {/* Agent nodes */}
        {[
          [220, 210],
          [690, 290],
          [1180, 320],
          [360, 420],
          [820, 440],
          [1260, 470],
          [280, 620],
          [840, 610],
          [1040, 180],
          [520, 700],
        ].map(([x, y], i) => (
          <g key={i} className={`landing-node landing-node-${i % 3}`}>
            <circle cx={x} cy={y} r="28" fill="url(#nodeGlow)" />
            <circle
              cx={x}
              cy={y}
              r="6"
              fill="hsl(168 50% 28%)"
              stroke="hsl(0 0% 100% / 0.7)"
              strokeWidth="1.5"
            />
          </g>
        ))}

        {/* Lakehouse slab silhouette */}
        <g opacity="0.22">
          <path
            d="M480 760 L720 690 L980 760 L720 830 Z"
            fill="hsl(210 35% 18%)"
          />
          <path
            d="M480 760 L480 790 L720 860 L720 830 Z"
            fill="hsl(210 35% 12%)"
          />
          <path
            d="M980 760 L980 790 L720 860 L720 830 Z"
            fill="hsl(210 35% 22%)"
          />
        </g>
      </svg>

      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[hsl(195_28%_96%)] to-transparent md:h-24" />
    </div>
  );
}
