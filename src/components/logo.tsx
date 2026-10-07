import Image from "next/image";
import Link from "next/link";

/**
 * Lead96 wordmark. `on="dark"` uses the white-text version for the sidebar.
 * Source files live in public/Logo; the trimmed renders used here are in public/brand.
 */
export function Logo({
  on = "light",
  height = 28,
  href = "/",
  className,
}: {
  on?: "light" | "dark";
  height?: number;
  href?: string | null;
  className?: string;
}) {
  const src = on === "dark" ? "/brand/lead96-wordmark-dark.png" : "/brand/lead96-wordmark.png";
  // Aspect ratios of the trimmed PNGs (light 1469×329, dark 1236×299).
  const width = Math.round(height * (on === "dark" ? 1236 / 299 : 1469 / 329));
  const img = <Image src={src} alt="Lead96" width={width} height={height} priority className={className} />;
  return href ? (
    <Link href={href} className="inline-flex items-center" aria-label="Lead96 home">
      {img}
    </Link>
  ) : (
    img
  );
}
