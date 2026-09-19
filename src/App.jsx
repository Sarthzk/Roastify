import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import Layout from "./routes/Layout";

// Each route is its own chunk so a visit to /history or /chat doesn't download Home's
// code (which drags in pdfjs-dist for the PDF upload UI). Layout stays eager — it's the
// header/footer around every route — and renders the <Suspense> boundary for these.
const Roaster = lazy(() => import("./routes/Roaster"));
const ChatList = lazy(() => import("./routes/ChatList"));
const ChatThread = lazy(() => import("./routes/ChatThread"));
const History = lazy(() => import("./routes/History"));
const SharedRoast = lazy(() => import("./routes/SharedRoast"));
const Privacy = lazy(() => import("./routes/Privacy"));

// No nested layouts beyond the one shared header/footer shell — see src/routes/Layout.jsx
// and CLAUDE.md's "Frontend structure" for the page-ownership split (session state in
// Layout, per-route state local to each route component so it resets on navigation
// rather than persisting across routes). /chat and /chat/:id are two route components,
// not one with an optional param — ChatList and ChatThread own genuinely different state
// (a paginated list vs. one open conversation's messages/composer), same reasoning as
// Roaster vs. History already being separate.
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Roaster />} />
        <Route path="chat" element={<ChatList />} />
        <Route path="chat/:id" element={<ChatThread />} />
        <Route path="history" element={<History />} />
        <Route path="r/:slug" element={<SharedRoast />} />
        <Route path="privacy" element={<Privacy />} />
      </Route>
    </Routes>
  );
}
