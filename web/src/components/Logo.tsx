interface LogoProps {
  size?: number;
  className?: string;
}

/** Medical asp entwined with two translation arrows. */
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
        <linearGradient id="aspid-grad" x1="7" y1="5" x2="41" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(164 72% 58%)" />
          <stop offset="0.52" stopColor="hsl(186 84% 57%)" />
          <stop offset="1" stopColor="hsl(266 76% 68%)" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="21" fill="hsl(205 32% 8%)" stroke="url(#aspid-grad)" strokeWidth="1.5" />
      <path d="M17 13.5h17l-4-4m4 4-4 4M31 34.5H14l4 4m-4-4 4-4" stroke="url(#aspid-grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M25.5 8.5c-5 2.2-6.8 6.3-3 9.4 3.8 3.2 5.3 5.2 1.5 8.2-3.8 3-2.9 7.1 1.7 9.4" stroke="url(#aspid-grad)" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M25.4 8.5c2.7-.2 4.5 1.2 5.3 3.2-2.1.6-4.3.1-5.8-1.2" fill="url(#aspid-grad)" />
      <circle cx="28.1" cy="10.1" r=".8" fill="hsl(205 35% 5%)" />
    </svg>
  );
}
