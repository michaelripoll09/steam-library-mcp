import type { ReactNode } from "react";

export type InlineNoticeTone = "info" | "success" | "warning" | "error";

export function InlineNotice({
  tone,
  children,
}: Readonly<{
  tone: InlineNoticeTone;
  children: ReactNode;
}>) {
  return (
    <p
      className={`inline-notice inline-notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
