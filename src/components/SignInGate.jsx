// Shared by every signed-in-only route (/chat, /chat/:id, /history) — a full-page
// sign-in gate, not a real URL redirect (no dedicated sign-in route exists, and a
// shared link must never dead-end — see CLAUDE.md's "Auth & persistence"). None of
// these routes render any of their own content, not even an empty state, alongside
// this — `title`/`copy` are the only per-route customization.
export default function SignInGate({ signIn, title, copy }) {
  return (
    <div className="roaster-studio">
      <div className="rs-gate">
        <span className="rs-gate-icon">&#128272;</span>
        <div className="rs-gate-title">{title}</div>
        <p className="rs-gate-copy">{copy}</p>
        <div className="rs-gate-actions">
          <button type="button" className="rs-source-prompt-btn" onClick={() => signIn("github")}>
            continue with github
          </button>
          <button type="button" className="rs-source-prompt-btn" onClick={() => signIn("google")}>
            continue with google
          </button>
        </div>
      </div>
    </div>
  );
}
