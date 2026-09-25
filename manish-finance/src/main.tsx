import { createRoot } from "react-dom/client";

function App() {
  return <p>Finance Desk</p>;
}

const el = document.getElementById("finance-root");
if (el) createRoot(el).render(<App />);
