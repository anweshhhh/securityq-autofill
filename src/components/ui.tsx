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

export function Button({ className, variant = "secondary", ...props }: ButtonProps) {
  return <button className={cx("btn", `btn-${variant}`, className)} {...props} />;
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
