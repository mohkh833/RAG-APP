import type { ButtonHTMLAttributes, ReactNode } from 'react';

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-verdigris text-white hover:bg-verdigris-dark disabled:bg-line-strong disabled:text-white',
  secondary:
    'bg-white text-ink border border-line hover:border-line-strong hover:bg-sage-50 disabled:text-faint',
  ghost:
    'bg-transparent text-muted hover:text-ink hover:bg-sage-200 disabled:text-faint',
  danger:
    'bg-brick text-white hover:brightness-95 disabled:bg-line-strong disabled:text-white',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'rounded-card border border-line bg-white shadow-[0_1px_2px_rgba(16,32,29,0.04)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-medium tracking-tight text-ink">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-verdigris-soft text-verdigris">
          {icon}
        </div>
      )}
      <h2 className="font-display text-lg text-ink">{title}</h2>
      <div className="max-w-md text-sm leading-relaxed text-muted">{children}</div>
    </div>
  );
}

type AlertTone = 'error' | 'warning' | 'success' | 'info';

const TONES: Record<AlertTone, string> = {
  error: 'border-brick/30 bg-brick-soft text-brick',
  warning: 'border-amber-ink/25 bg-amber-soft text-amber-ink',
  success: 'border-verdigris-ring bg-verdigris-soft text-verdigris-dark',
  info: 'border-line bg-sage-50 text-ink-soft',
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('rounded-lg border px-4 py-3 text-sm', TONES[tone], className)}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cx(title && 'mt-1')}>{children}</div>}
    </div>
  );
}

/** Renders class-validator's message array as a readable list, never raw JSON. */
export function MessageList({ messages }: { messages: string[] }) {
  if (messages.length === 1) return <p>{messages[0]}</p>;
  return (
    <ul className="list-disc space-y-1 ps-5">
      {messages.map((message, index) => (
        <li key={`${index}-${message}`}>{message}</li>
      ))}
    </ul>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cx('h-4 w-4 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeOpacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-semibold uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-verdigris focus:outline-none';
