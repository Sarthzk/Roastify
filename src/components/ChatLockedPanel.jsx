// Shared by both /chat (ChatList.jsx) and /chat/:id (ChatThread.jsx) — identical copy,
// same treatment as History.jsx's own locked panel (never a redirect, so a shared chat
// link isn't a dead end for a signed-out visitor).
export default function ChatLockedPanel({ signIn }) {
  return (
    <section className="row">
      <div className="row-label row-label--accent">Locked</div>
      <div className="history-empty-body">
        <div className="invitation-top">
          <span className="invitation-icon">&#8226;</span>
          <span className="invitation-msg">Chat starts the moment you sign in.</span>
        </div>
        <p className="history-empty-copy">
          Conversations pick up in the same voice that roasted you and carry that roast as
          context the whole way through. Sign in to open one from a finished roast or a
          saved one in your history.
        </p>
        <div className="history-empty-actions">
          <button type="button" className="history-empty-provider" onClick={() => signIn("github")}>
            continue with github
          </button>
          <button
            type="button"
            className="history-empty-provider history-empty-provider--secondary"
            onClick={() => signIn("google")}
          >
            google
          </button>
        </div>
      </div>
    </section>
  );
}
