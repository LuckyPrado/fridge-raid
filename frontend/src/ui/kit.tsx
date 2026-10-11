import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { AGENT_NAMES, AGENT_SPRITES, ICONS, SPRITE_OUTLINE, type IconName } from "../pixel/art";
import { PixelSprite } from "../pixel/PixelSprite";
import type { AgentId } from "../types";

type IconProps = {
  name: IconName;
  scale?: number;
  className?: string;
};

export function Icon({ name, scale = 2, className }: IconProps) {
  return <PixelSprite sprite={ICONS[name]} scale={scale} className={className} />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "leaf" | "paper" | "butter" | "night";
  size?: "lg" | "md" | "sm";
  icon?: IconName;
  isBlock?: boolean;
};

export function Button({ tone = "leaf", size = "md", icon, isBlock, className, children, ...rest }: ButtonProps) {
  const classes = ["btn", `btn-${tone}`, `btn-${size}`, isBlock ? "btn-block" : "", className ?? ""];
  return (
    <button type="button" className={classes.filter(Boolean).join(" ")} {...rest}>
      <span>{children}</span>
      {icon && <Icon name={icon} scale={size === "lg" ? 2 : 1.5} />}
    </button>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  tone?: "paper" | "night" | "plain";
};

export function IconButton({ icon, label, tone = "paper", className, ...rest }: IconButtonProps) {
  return (
    <button type="button" className={`icon-btn icon-btn-${tone} ${className ?? ""}`} aria-label={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

type AgentBubbleProps = {
  agent: AgentId;
  children: ReactNode;
  isSpeaking?: boolean;
};

/** One of the three agents talking: their sprite, their name, and one line of speech. */
export function AgentBubble({ agent, children, isSpeaking }: AgentBubbleProps) {
  return (
    <article className={`bubble bubble-${agent} ${isSpeaking ? "is-speaking" : ""}`}>
      <PixelSprite sprite={AGENT_SPRITES[agent]} scale={3} outline={SPRITE_OUTLINE} className="bubble-sprite" />
      <div className="bubble-body">
        <p className="eyebrow">{AGENT_NAMES[agent]}</p>
        <p className="bubble-text">{children}</p>
      </div>
    </article>
  );
}

type ChipProps = {
  tone?: "mint" | "peach" | "butter" | "paper" | "teal";
  children: ReactNode;
};

export function Chip({ tone = "mint", children }: ChipProps) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

type SegBarProps = {
  filled: number;
  total: number;
  label: string;
  tone?: "leaf" | "teal" | "carrot" | "gold";
};

/** A progress bar made of square blocks, like a game health bar. */
export function SegBar({ filled, total, label, tone = "leaf" }: SegBarProps) {
  return (
    <div className={`segbar segbar-${tone}`} role="img" aria-label={label}>
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={index < filled ? "seg is-on" : "seg"} />
      ))}
    </div>
  );
}

type ScreenHeaderProps = {
  eyebrow: string;
  title: string;
  onBack?: () => void;
  action?: ReactNode;
};

export function ScreenHeader({ eyebrow, title, onBack, action }: ScreenHeaderProps) {
  return (
    <header className="screen-header">
      {onBack && <IconButton icon="back" label="Back" tone="plain" onClick={onBack} />}
      <div className="screen-header-text">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}

type SheetProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/** A panel that slides up from the bottom of the phone for short forms. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const panel = useRef<HTMLElement>(null);

  // Move focus into the sheet when it opens and hand it back when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (panel.current && !panel.current.contains(document.activeElement)) {
      panel.current.focus();
    }
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        ref={panel}
        tabIndex={-1}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-header">
          <h2>{title}</h2>
          <IconButton icon="close" label="Close" tone="plain" onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}

type FieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
};

export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

type SectionTitleProps = {
  title: string;
  aside?: ReactNode;
};

export function SectionTitle({ title, aside }: SectionTitleProps) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {aside && <span className="section-aside">{aside}</span>}
    </div>
  );
}
