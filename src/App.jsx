import { Route, Routes } from "react-router-dom";
import Layout from "./routes/Layout";
import Roaster from "./routes/Roaster";
import ChatList from "./routes/ChatList";
import ChatThread from "./routes/ChatThread";
import History from "./routes/History";
import SharedRoast from "./routes/SharedRoast";
import Privacy from "./routes/Privacy";

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
