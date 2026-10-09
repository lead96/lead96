import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { ComponentProps, ComponentType, ReactNode, SVGProps } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/** Any line icon component (lucide-react icons fit). */
export type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-brand-600/60",
  secondary: "border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
};

/**
 * Button classes, also used to style links as buttons. The `btn` marker lets PageHeader make
 * header buttons full-width on phones.
 */
export function buttonClass(variant: ButtonVariant = "primary", className?: string, size: "md" | "sm" = "md") {
  return cx(
    "btn inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 disabled:cursor-not-allowed",
    size === "sm" ? "px-3 py-1.5 text-[13px]" : "px-4 py-2 text-sm",
    buttonVariants[variant],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "md" | "sm" }) {
  return <button className={buttonClass(variant, className, size)} {...props} />;
}

const fieldClass =
  "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:bg-slate-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(fieldClass, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(fieldClass, className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl border border-slate-200/80 bg-white shadow-card", className)} {...props} />;
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const tones = {
    info: "border-brand-200 bg-brand-50 text-brand-900",
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800", // mint #10B981 family
  };
  return <div className={cx("rounded-lg border px-3 py-2 text-sm", tones[tone])}>{children}</div>;
}

/** A titled block inside a page: heading, optional one-line description and action on the right. */
export function Section({ title, description, action, children, className }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("space-y-4", className)}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Page title + description; actions sit on the right, and go full-width under the title on phones. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Link to the parent page, shown small above the title. */
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
            <ArrowLeft size={16} aria-hidden />
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 max-sm:[&_.btn]:flex-1">{actions}</div> : null}
    </div>
  );
}

// Palette: blue (actions, active), green (success, won), gray (neutral).
// Amber and red are only for warnings and errors.
const badgeTones = {
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-brand-50 text-brand-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
} as const;
export type Tone = keyof typeof badgeTones;

export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium", badgeTones[tone])}>
      {children}
    </span>
  );
}

const tileTones = {
  blue: "bg-brand-50 text-brand-600",
  green: "bg-emerald-50 text-emerald-600",
  slate: "bg-slate-100 text-slate-500",
} as const;

/** An icon on a soft colored square. */
export function IconTile({ icon: I, tone = "blue", size = "md" }: { icon: Icon; tone?: keyof typeof tileTones; size?: "sm" | "md" | "lg" }) {
  const box = { sm: "h-8 w-8 rounded-lg", md: "h-10 w-10 rounded-lg", lg: "h-12 w-12 rounded-xl" }[size];
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center", box, tileTones[tone])} aria-hidden>
      <I size={size === "lg" ? 24 : size === "md" ? 20 : 16} strokeWidth={1.75} />
    </span>
  );
}

/** Dashboard number card: icon + title + small gray subtitle, a big number, and a footer note. */
export function StatCard({
  icon,
  title,
  subtitle,
  value,
  footer,
  tone = "blue",
  muted = false,
}: {
  icon: Icon;
  title: string;
  subtitle: string;
  value: ReactNode;
  footer: string;
  tone?: keyof typeof tileTones;
  muted?: boolean;
}) {
  return (
    <Card className="flex flex-col p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <IconTile icon={icon} tone={tone} size="sm" />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-slate-900 sm:truncate">{title}</p>
          <p className="line-clamp-2 text-xs text-slate-500 sm:truncate">{subtitle}</p>
        </div>
      </div>
      <p className={cx("my-5 text-3xl font-semibold tabular-nums tracking-tight sm:my-6 sm:text-center", muted ? "text-slate-300" : "text-slate-900")}>
        {value}
      </p>
      <p className="mt-auto border-t border-slate-100 pt-3 text-xs text-slate-500">{footer}</p>
    </Card>
  );
}

type Cta = { href: string; label: string; variant?: ButtonVariant };

/** Friendly empty state: icon, title, one or two sentences, and what to do next. */
export function EmptyState({
  icon,
  title,
  description,
  actions = [],
  children,
  className,
}: {
  icon: Icon;
  title: string;
  description?: ReactNode;
  actions?: Cta[];
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center px-6 py-14 text-center sm:py-16", className)}>
      <IconTile icon={icon} size="lg" />
      <h2 className="mt-4 text-base font-semibold text-slate-900">{title}</h2>
      {description ? <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">{description}</p> : null}
      {actions.length ? (
        <div className="mt-6 flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row">
          {actions.map((a, i) => (
            <Link key={a.href} href={a.href} className={buttonClass(a.variant ?? (i === 0 ? "primary" : "secondary"))}>
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A clickable "next step" card, as used in empty states. */
export function ActionCard({ href, icon, title, description, tone = "blue" }: { href: string; icon: Icon; title: string; description: string; tone?: keyof typeof tileTones }) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-5 text-left shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50/30"
    >
      <IconTile icon={icon} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
      <ChevronRight size={18} aria-hidden className="mt-2.5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
