import React from "react";
import { createRoot } from "react-dom/client";
import AegisApp from "./AegisApp";
import "./globals.css";

type ViewMode =
  | "landing"
  | "report"
  | "track"
  | "command"
  | "responder"
  | "simulate"
  | "relocation";

function resolveRoute(pathname: string): { view: ViewMode; reportId?: string } {
  const clean = pathname.replace(/\/+$/, "") || "/";

  if (clean.startsWith("/track/")) {
    const reportId = decodeURIComponent(clean.slice("/track/".length));
    return { view: "track", reportId };
  }

  switch (clean) {
    case "/report":
      return { view: "report" };
    case "/command":
      return { view: "command" };
    case "/responder":
      return { view: "responder" };
    case "/simulate":
      return { view: "simulate" };
    case "/relocation":
      return { view: "relocation" };
    case "/home":
    case "/landing":
      return { view: "landing" };
    case "/":
    default:
      // Keep the original downloaded build behavior: root opens Command Center.
      return { view: "command" };
  }
}

const route = resolveRoute(window.location.pathname);
const root = document.getElementById("root");

if (!root) {
  throw new Error("AEGIS root element was not found.");
}

createRoot(root).render(<AegisApp view={route.view} reportId={route.reportId} />);
