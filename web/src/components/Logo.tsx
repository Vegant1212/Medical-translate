interface LogoProps {
  size?: number;
  className?: string;
}

/** Bidirectional cross mark — the app's signature glyph. */
export function Logo({ size = 32, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
      role="presentation"
    >
      <defs>
        <linearGradient id="ml-grad" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(164 66% 62%)" />
          <stop offset="1" stopColor="hsl(186 80% 45%)" />
        </linearGradient>
      </defs>
      <rect x="19.5" y="4" width="9" height="40" rx="3" fill="url(#ml-grad)" />
      <path
        d="M18 16.5 6.5 24 18 31.5v-6.2h12v6.2L41.5 24 30 16.5v6.2H18v-6.2Z"
        fill="url(#ml-grad)"
        opacity="0.95"
      />
      <rect x="22" y="10" width="4" height="3.2" rx="1.2" fill="hsl(205 35% 6%)" opacity="0.55" />
      <rect x="22" y="34.8" width="4" height="3.2" rx="1.2" fill="hsl(205 35% 6%)" opacity="0.55" />
    </svg>
  );
}
