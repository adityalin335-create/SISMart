import "core-js/actual/array/at";
import "core-js/actual/array/flat";
import "core-js/actual/object/from-entries";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing application root element.");
}
createRoot(rootElement).render(<App />);
