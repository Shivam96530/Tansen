import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";

// Suppress benign third-party YouTube widget postMessage origin warnings
if (typeof window !== "undefined") {
  const origError = console.error;
  console.error = (...args: any[]) => {
    const first = String(args[0] ?? "");
    if (first.includes("postMessage") && first.includes("DOMWindow")) {
      return;
    }
    origError.apply(console, args);
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
