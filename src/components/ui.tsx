import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  TextareaHTMLAttributes
} from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "shell";
};

function deriveAriaLabel(children: ButtonProps["children"]): string | undefined {
  if (typeof children === "string") {
    const trimmed = children.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(children)) {
    const text = children
      .map((child) => (typeof child === "string" ? child.trim() : ""))
      .filter((part) => part.length > 0)
      .join(" ")
      .trim();

    return text.length > 0 ? text : undefined;
  }

  return undefined;
}

export function Button({ className, variant = "secondary", children, ...props }: ButtonProps) {
  const ariaLabel = props["aria-label"] ?? deriveAriaLabel(children);
  return (
    <button className={cx("btn", `btn-${variant}`, className)} {...props} aria-label={ariaLabel}>
      {children}
    </button>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className, ...props }: InputProps) {
  return <input className={cx("input", className)} {...props} />;
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({ className, ...props }: TextAreaProps) {
  return <textarea className={cx("textarea", className)} {...props} />;
}

type CardProps = HTMLAttributes<HTMLElement>;

export function Card({ className, children, ...props }: PropsWithChildren<CardProps>) {
  return (
    <section className={cx("card", className)} {...props}>
      {children}
    </section>
  );
}

export function Badge({
  className,
  children,
  tone = "draft",
  title
}: PropsWithChildren<{
  className?: string;
  tone?: "approved" | "review" | "draft" | "notfound";
  title?: string;
}>) {
  return (
    <span className={cx("badge", `status-${tone}`, className)} title={title}>
      {children}
    </span>
  );
}
