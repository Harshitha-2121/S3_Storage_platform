import Image from "next/image";
import { cn } from "@v1/ui/utils";

/**
 * Brand logo (source file is 1587x1545, not square). Rendered with `fill`
 * inside a fixed-size wrapper so explicit width/height props never fight CSS
 * (which triggered Next.js "width or height modified" warnings) and the
 * aspect ratio is preserved via object-cover.
 */
export function Logo({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden={false}
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-full",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src="/logo.png"
        alt="logo"
        fill
        sizes={`${size}px`}
        priority
        className="object-cover"
      />
    </span>
  );
}
