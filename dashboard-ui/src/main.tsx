import { createRoot } from "react-dom/client";

import { DashboardApp } from "./app.js";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Dashboard root element is missing.");

createRoot(root).render(<DashboardApp />);
