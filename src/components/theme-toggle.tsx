import { setTheme } from '@/lib/actions/theme';

const OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

/**
 * A three-way switch that works without JavaScript: each option is a submit
 * button on a server action that writes the cookie. The server then renders
 * data-theme on <html> before anything paints.
 */
export function ThemeToggle({ current }: { current: 'auto' | 'light' | 'dark' }) {
  return (
    <form action={setTheme} className="theme-switch" aria-label="Colour theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="submit"
          name="theme"
          value={option.value}
          aria-pressed={current === option.value}
          title={`${option.label} theme`}
        >
          {option.label}
        </button>
      ))}
    </form>
  );
}
