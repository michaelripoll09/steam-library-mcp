// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { AppShell } from "../../dashboard-ui/src/navigation/app-shell.js";

afterEach(cleanup);

test("keeps compact navigation destinations identifiable without clipped text", () => {
  render(
    <AppShell activeView="home" onViewChange={() => {}}>
      <main />
    </AppShell>,
  );
  for (const label of [
    "Inicio",
    "Biblioteca",
    "Play Now",
    "Backlog",
    "Colección manual",
    "Tareas",
  ]) {
    const button = screen.getByRole("button", { name: label });
    expect(button).toHaveAttribute("title", label);
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  }
});
