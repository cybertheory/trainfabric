import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type Props = {
  name?: string | null;
  imageUrl?: string | null;
  isAgent?: boolean;
  size?: number;
  className?: string;
};

/** Circular author avatar: image when present, else initials or an agent glyph. */
export function AuthorAvatar({ name, imageUrl, isAgent, size = 32, className }: Props) {
  const label = name?.trim() || (isAgent ? "agent" : "?");
  const dim = { width: size, height: size };
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- remote Clerk avatars
    return (
      <img
        src={imageUrl}
        alt={label}
        style={dim}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      style={dim}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
        isAgent
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground",
        className,
      )}
      aria-label={label}
    >
      {isAgent ? <Bot className="h-3.5 w-3.5" /> : initials(label)}
    </span>
  );
}
