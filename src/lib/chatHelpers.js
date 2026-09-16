// Pure logic shared between the chat list (src/routes/ChatList.jsx) and history's own row
// date formatting (src/routes/History.jsx) — extracted here rather than duplicated,
// matching how src/lib/roasterErrors.js/inputFormHelpers.js already pull component logic
// out for independent test coverage without breaking Vite Fast Refresh.

export function formatDate(iso) {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short" }).toLowerCase();
  return `${day} ${month}`;
}

// The chat list row's primary line — a "you:" prefix distinguishes the caller's own last
// message from the persona's reply, matching a real chat client's convention. Truncation
// to fit the row is CSS's job (text-overflow: ellipsis, same as .hist-row-handle), not
// this function's — it returns the full string either way.
export function lastMessagePreview(lastMessage) {
  if (!lastMessage) return "No messages yet — say something.";
  return lastMessage.role === "user" ? `you: ${lastMessage.content}` : lastMessage.content;
}
