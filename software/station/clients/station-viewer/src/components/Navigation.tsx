import { Link, useLocation } from "react-router-dom";
import { useTheme } from "@/hooks/useTheme";
import { isElectron } from "@/utils/platform";
import { Laptop, Moon, Sun } from "lucide-react";

const THEME_OPTIONS = ['auto', 'light', 'dark'] as const;
const THEME_LABELS = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
} as const;
const THEME_ICONS = {
  auto: Laptop,
  light: Sun,
  dark: Moon,
} as const;

function Navigation() {
  const location = useLocation();
  const { themePreference, setThemePreference } = useTheme();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const handleCycleTheme = () => {
    const currentIndex = THEME_OPTIONS.indexOf(themePreference);
    const nextIndex = (currentIndex + 1) % THEME_OPTIONS.length;
    setThemePreference(THEME_OPTIONS[nextIndex]);
  };

  const nextThemePreference = THEME_OPTIONS[(THEME_OPTIONS.indexOf(themePreference) + 1) % THEME_OPTIONS.length];
  const ThemeIcon = THEME_ICONS[themePreference];

  const logoSrc = isElectron() ? './logo.svg' : '/logo.svg';

  return (
    <div className="relative z-40 bg-surface-primary border-b-2 border-border-default">
      <div className="px-4 py-2 flex items-center gap-4">
        <Link to="/" className="group">
          <img
            src={logoSrc}
            alt="Station View"
            title="NormaCore"
            className="h-8 logo-first-load logo-invert opacity-80 transition-opacity duration-200 group-hover:opacity-100"
          />
        </Link>
        <nav className="flex gap-4">
          <Link
            to="/"
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              isActive("/")
                ? "bg-accent-success-bg text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-tertiary"
            }`}
          >
            Home
          </Link>
          <Link
            to="/history"
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              isActive("/history")
                ? "bg-accent-success-bg text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-tertiary"
            }`}
          >
            History
          </Link>
        </nav>

        <button
          type="button"
          onClick={handleCycleTheme}
          className="group relative ml-auto inline-flex items-center gap-2 rounded-lg border border-border-default bg-surface-secondary px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-tertiary"
          aria-label={`Theme: ${THEME_LABELS[themePreference]}. Switch to ${THEME_LABELS[nextThemePreference]}.`}
          title={`Theme: ${THEME_LABELS[themePreference]} -> ${THEME_LABELS[nextThemePreference]}`}
        >
          <ThemeIcon size={14} className="text-text-muted" />
          <span className="hidden sm:inline rounded bg-surface-primary px-2 py-0.5 text-text-primary shadow-sm">
            {THEME_LABELS[themePreference]}
          </span>
          <span className="pointer-events-none invisible absolute left-1/2 top-full z-50 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-surface-primary px-2 py-1 text-[11px] font-medium text-text-primary opacity-0 shadow-lg ring-1 ring-border-default transition-all duration-150 group-hover:visible group-hover:opacity-100 sm:block">
            {`Switch to ${THEME_LABELS[nextThemePreference]}`}
          </span>
        </button>

        <span
          className="hidden text-[11px] font-mono text-text-muted sm:inline"
          title="Station build version and commit hash"
        >
          {`⎇ ${__STATION_VERSION__}`}
        </span>
      </div>
    </div>
  );
}

export default Navigation;
