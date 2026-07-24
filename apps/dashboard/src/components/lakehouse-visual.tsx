export function LakehouseVisual() {
  const particles = [
    [980, 160],
    [1080, 210],
    [1180, 180],
    [1260, 250],
    [1020, 300],
    [1140, 340],
    [1320, 300],
    [960, 400],
    [1100, 430],
    [1240, 400],
    [1340, 460],
    [1000, 520],
    [1160, 560],
    [1280, 540],
    [900, 280],
    [860, 460],
    [1060, 620],
    [1200, 660],
  ] as const;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="lake" x1="0%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stopColor="#eef6f8" />
            <stop offset="42%" stopColor="#d7ebea" />
            <stop offset="100%" stopColor="#b9d4e0" />
          </linearGradient>
          <linearGradient id="stream" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(168 55% 34%)" stopOpacity="0" />
            <stop offset="45%" stopColor="hsl(168 60% 32%)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="hsl(195 50% 40%)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(168 70% 42%)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="hsl(168 70% 42%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="heroFade" cx="25%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#eef6f8" stopOpacity="0.92" />
            <stop offset="55%" stopColor="#eef6f8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#eef6f8" stopOpacity="0" />
          </radialGradient>
          <filter id="soft">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
        </defs>

        <rect width="1440" height="900" fill="url(#lake)" />

        {/* Soft left veil so copy stays readable */}
        <rect width="1440" height="900" fill="url(#heroFade)" />

        {/* Depth bands */}
        <g className="landing-ripple" opacity="0.28">
          <path
            d="M620 500 C 820 455, 980 560, 1220 510 S 1480 470, 1560 520"
            fill="none"
            stroke="hsl(210 25% 38%)"
            strokeWidth="1"
            opacity="0.28"
          />
          <path
            d="M640 560 C 860 515, 1020 620, 1260 570 S 1480 530, 1560 580"
            fill="none"
            stroke="hsl(210 25% 38%)"
            strokeWidth="1"
            opacity="0.18"
          />
          <path
            d="M660 620 C 880 580, 1060 680, 1300 630 S 1500 590, 1560 640"
            fill="none"
            stroke="hsl(210 25% 38%)"
            strokeWidth="1"
            opacity="0.12"
          />
        </g>

        {/* Shared query paths — biased right like Mintlify particle field */}
        <g stroke="url(#stream)" strokeWidth="1.75" fill="none" filter="url(#soft)">
          <path className="landing-stream landing-stream-a" d="M760 220 C 900 180, 1020 300, 1180 250" />
          <path className="landing-stream landing-stream-b" d="M820 340 C 960 300, 1100 420, 1280 360" />
          <path className="landing-stream landing-stream-c" d="M780 460 C 940 400, 1080 520, 1260 470" />
          <path className="landing-stream landing-stream-d" d="M860 560 C 1000 510, 1140 620, 1320 560" />
          <path className="landing-stream landing-stream-e" d="M900 280 C 1040 260, 1120 340, 1240 300" />
        </g>

        {/* Particle field */}
        {particles.map(([x, y], i) => (
          <g key={i} className={`landing-node landing-node-${i % 3}`}>
            <circle cx={x} cy={y} r={i % 4 === 0 ? 22 : 14} fill="url(#nodeGlow)" opacity="0.85" />
            <circle
              cx={x}
              cy={y}
              r={i % 5 === 0 ? 4.5 : 2.75}
              fill="hsl(168 55% 28%)"
              stroke="hsl(0 0% 100% / 0.55)"
              strokeWidth="1"
            />
          </g>
        ))}

        {/* Lakehouse slab — quieter, lower-right anchor */}
        <g opacity="0.18" transform="translate(180 40)">
          <path d="M620 700 L860 640 L1100 700 L860 760 Z" fill="hsl(210 35% 16%)" />
          <path d="M620 700 L620 724 L860 784 L860 760 Z" fill="hsl(210 35% 10%)" />
          <path d="M1100 700 L1100 724 L860 784 L860 760 Z" fill="hsl(210 35% 20%)" />
        </g>
      </svg>
    </div>
  );
}
