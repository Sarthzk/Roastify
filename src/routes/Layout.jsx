import { Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { deleteAccount, getRateLimitStatus } from "../lib/openai";
import { useDismissiblePanel } from "../lib/useDismissiblePanel";

// Persists across every route (header + footer); everything else — hero, form, output,
// history list — belongs to one route only. Session state and the sign-in/out calls
// live here (not in the roaster page) because the header needs them on every route, not
// just "/" — see CLAUDE.md's "Frontend structure" for why roaster-specific state stays
// local to the roaster route instead.
export default function Layout() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  // False until supabase.auth.getSession() has answered (immediately true when Supabase
  // isn't configured) — the first render always has session === null even for someone
  // who is signed in, so anything keyed to it must wait for this before treating null as
  // "anonymous".
  const [sessionResolved, setSessionResolved] = useState(!supabase);
  // Independent of Roaster.jsx's own rateLimitStatus (which drives Home's Instagram
  // gating and its own rate line) — this is purely for the header's quota badge, which
  // needs to show on every route, not just "/". A second /api/rate-limit-status fetch is
  // simpler and safer than threading Home's state up through this shared component.
  const [quota, setQuota] = useState(null);
  // Merges a roast response's own { limit, remaining, reset } into the badge so it updates
  // the moment a roast finishes, instead of only on the next page load / session change.
  // Merge (not replace) so `unlimited` and any other field from the initial fetch survive.
  function updateQuota(rateLimit) {
    setQuota((prev) => (prev ? { ...prev, ...rateLimit } : prev));
  }
  const [signInOpen, setSignInOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // Mobile-only: at <=600px the nav and account controls collapse behind a hamburger (see
  // the 600px block in index.css). Desktop CSS never reads this — the toggle button is
  // display:none there — so it has no visual effect above that width.
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const headerRef = useRef(null);
  const authRef = useRef(null);
  const triggerRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const deleteTriggerRef = useRef(null);
  const cancelDeleteRef = useRef(null);

  // The "delete account" button and its "cancel" counterpart each unmount the moment
  // they're clicked (the confirm box replaces one, the plain trigger replaces the
  // other), so a click leaves focus on a detached node instead of anywhere useful —
  // same class of gap the sign-in dropdown had before its own focus-trap fix. Moves
  // focus onto whichever button actually exists after the swap: "cancel" (never the
  // destructive button) when entering confirm, the plain trigger when leaving it.
  // Keyed only to `confirmingDelete` — opening/closing the panel itself shouldn't yank
  // focus down into this row, and when the panel isn't open both refs are null (nothing
  // rendered to focus), so there's nothing to guard against there.
  useEffect(() => {
    if (confirmingDelete) cancelDeleteRef.current?.focus();
    else deleteTriggerRef.current?.focus();
  }, [confirmingDelete]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionResolved(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  // Refetches on every session change — same reasoning as Roaster.jsx's own copy: the
  // caller's tier (and so their limit/remaining) depends on it.
  useEffect(() => {
    if (!sessionResolved) return;
    getRateLimitStatus(session?.access_token).then(setQuota).catch(() => {});
  }, [session, sessionResolved]);

  // Closes both panels the moment session changes — a session *appearing* covers both
  // the sign-in panel's own provider buttons and the roaster page's separate inline
  // locked-source prompt, which signs in directly without ever opening this panel; a
  // session *disappearing* (sign out, or a successful account deletion) closes the
  // account panel and resets its delete-confirm state, so it never reopens already
  // mid-confirm the next time someone signs in on the same device. Adjusted during
  // render (React's own pattern for "reset state when a prop changes") rather than in an
  // effect, which would cost an extra render pass for a synchronous setState call.
  const [prevSession, setPrevSession] = useState(session);
  if (session !== prevSession) {
    setPrevSession(session);
    if (session) {
      setSignInOpen(false);
    } else {
      setAccountOpen(false);
      setConfirmingDelete(false);
      setDeleteError(null);
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e) {
      if (headerRef.current && !headerRef.current.contains(e.target)) setMenuOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const closeSignIn = useDismissiblePanel(signInOpen, {
    containerRef: authRef,
    triggerRef,
    onDismiss: () => setSignInOpen(false),
  });

  const closeAccount = useDismissiblePanel(accountOpen, {
    containerRef: authRef,
    triggerRef: accountTriggerRef,
    onDismiss: () => {
      setAccountOpen(false);
      setConfirmingDelete(false);
      setDeleteError(null);
    },
  });

  async function signIn(provider) {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  async function handleDeleteAccount() {
    setDeletingAccount(true);
    setDeleteError(null);
    try {
      await deleteAccount(session.access_token);
      await signOut();
      navigate("/");
    } catch (err) {
      setDeleteError(err.message);
      setDeletingAccount(false);
    }
  }

  const email = session?.user?.email ?? "";
  const userHandle = email ? `@${email.split("@")[0]}` : "";
  const userInitial = email ? email[0].toUpperCase() : "?";
  const provider = session?.user?.app_metadata?.provider ?? "";
  const avatarUrl = session?.user?.user_metadata?.avatar_url || session?.user?.user_metadata?.picture || "";
  const displayName = session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || userHandle;

  function navClass({ isActive }) {
    return `nav-item${isActive ? " is-active" : ""}`;
  }

  return (
    <div className="app-root">
      <header ref={headerRef} className={`header${menuOpen ? " is-menu-open" : ""}`}>
        <Link to="/" className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Roastify</span>
        </Link>

        <nav className="nav" id="header-menu-nav">
          <NavLink to="/" end className={navClass} onClick={() => setMenuOpen(false)}>
            Roaster
          </NavLink>
          <NavLink to="/chat" className={navClass} onClick={() => setMenuOpen(false)}>
            Chat
          </NavLink>
          <NavLink to="/history" className={navClass} onClick={() => setMenuOpen(false)}>
            History
          </NavLink>
          <NavLink to="/privacy" className={navClass} onClick={() => setMenuOpen(false)}>
            Privacy &amp; Data
          </NavLink>
        </nav>

        <div className="hspacer" />

        {/* Real remaining/limit from /api/rate-limit-status — never a hardcoded number.
            Anonymous callers are keyed by IP, signed-in ones by user id (see
            api/rate-limit-status.js); "unlimited" is the dev bypass, not a fabricated
            infinite quota. */}
        {quota && (
          <span className={`quota-badge${quota.unlimited ? " is-unlimited" : ""}`}>
            <span className="quota-badge-dot" />
            {quota.unlimited ? "QUOTA: UNLIMITED (DEV)" : `QUOTA: ${quota.remaining}/${quota.limit} BURNS LEFT`}
          </span>
        )}

        <button
          type="button"
          className={`menu-toggle${menuOpen ? " is-open" : ""}`}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="header-menu-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="menu-toggle-bar" />
          <span className="menu-toggle-bar" />
          <span className="menu-toggle-bar" />
        </button>

        {isSupabaseConfigured ? (
          <div className="auth" ref={authRef}>
            {session ? (
              <>
                <button
                  ref={accountTriggerRef}
                  type="button"
                  className={`auth-user${accountOpen ? " is-open" : ""}`}
                  onClick={() => setAccountOpen((open) => !open)}
                >
                  <span className="auth-avatar">{userInitial}</span>
                  <span className="auth-handle">{userHandle}</span>
                  <span className={`auth-caret${accountOpen ? " is-open" : ""}`}>&#9662;</span>
                </button>
                <button type="button" className="auth-signout" onClick={signOut}>
                  sign out
                </button>
              </>
            ) : (
              <button
                ref={triggerRef}
                type="button"
                className={`auth-trigger${signInOpen ? " is-open" : ""}`}
                onClick={() => setSignInOpen((open) => !open)}
              >
                <span>&#128273; sign in</span>
                <span className={`auth-caret${signInOpen ? " is-open" : ""}`}>&#9662;</span>
              </button>
            )}

            {signInOpen && !session && (
              <div className="signin-panel">
                <div className="signin-panel-head">
                  <span className="signin-panel-title">sign in</span>
                  <button type="button" className="signin-panel-close" onClick={closeSignIn}>
                    close
                  </button>
                </div>
                <p className="signin-panel-copy">
                  15 roasts a day, instagram unlocked, and every roast saved to your history.
                </p>
                <button type="button" className="signin-provider" onClick={() => signIn("github")}>
                  <span className="signin-provider-mark" />
                  continue with github
                  <span className="signin-provider-arrow">&#8594;</span>
                </button>
                <button type="button" className="signin-provider" onClick={() => signIn("google")}>
                  <span className="signin-provider-mark signin-provider-mark--google" />
                  continue with google
                  <span className="signin-provider-arrow">&#8594;</span>
                </button>
              </div>
            )}

            {accountOpen && session && (
              <div className="account-panel">
                <div className="signin-panel-head">
                  <span className="signin-panel-title">account</span>
                  <button type="button" className="signin-panel-close" onClick={closeAccount}>
                    close
                  </button>
                </div>
                <div className="account-panel-body">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="account-panel-avatar" />
                  ) : (
                    <span className="account-panel-avatar account-panel-avatar--fallback">{userInitial}</span>
                  )}
                  <div className="account-panel-info">
                    <span className="account-panel-name">{displayName}</span>
                    <span className="account-panel-email">{email}</span>
                    {provider && <span className="account-panel-provider">{provider}</span>}
                  </div>
                </div>

                <div className="account-panel-danger">
                  {!confirmingDelete ? (
                    <button
                      ref={deleteTriggerRef}
                      type="button"
                      className="account-panel-delete-trigger"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      delete account
                    </button>
                  ) : (
                    <div className="privacy-confirm">
                      <span className="hist-row-confirm-text">
                        This permanently deletes your account and every roast on it. This can't be undone.
                      </span>
                      <span className="hist-row-confirm-actions">
                        <button
                          type="button"
                          className="hist-row-confirm-yes"
                          onClick={handleDeleteAccount}
                          disabled={deletingAccount}
                        >
                          {deletingAccount ? "deleting…" : "yes, delete everything"}
                        </button>
                        <button
                          ref={cancelDeleteRef}
                          type="button"
                          className="hist-row-confirm-cancel"
                          onClick={() => setConfirmingDelete(false)}
                          disabled={deletingAccount}
                        >
                          cancel
                        </button>
                      </span>
                    </div>
                  )}
                  {deleteError && <p className="privacy-error">Couldn't delete your account — {deleteError}</p>}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="hmeta">
            <span className="hmeta-item">no login</span>
          </div>
        )}
      </header>

      <main className="app-main">
        <Suspense fallback={null}>
          <Outlet context={{ session, signIn, signOut, updateQuota, openSignIn: () => { setMenuOpen(true); setSignInOpen(true); } }} />
        </Suspense>
      </main>

      <footer className="footer">
        <div className="footer-name">Developed by Sarthak Mohite</div>
        <Link to="/privacy" className="footer-link">
          Privacy
        </Link>
        <div className="footer-spacer" />
        <div className="footer-brand">
          <span className="footer-brand-mark" />
          <span className="footer-brand-name">Roastify</span>
        </div>
      </footer>
    </div>
  );
}
