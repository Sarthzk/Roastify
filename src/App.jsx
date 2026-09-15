import { Route, Routes } from "react-router-dom";
import Layout from "./routes/Layout";
import Roaster from "./routes/Roaster";
import History from "./routes/History";
import SharedRoast from "./routes/SharedRoast";

// Three routes, no nested layouts beyond the one shared header/footer shell — see
// src/routes/Layout.jsx and CLAUDE.md's "Frontend structure" for the page-ownership
// split (session state in Layout, roaster-specific state local to Roaster so it resets
// on navigation rather than persisting across routes).
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Roaster />} />
        <Route path="history" element={<History />} />
        <Route path="r/:slug" element={<SharedRoast />} />
      </Route>
    </Routes>
  );
}
