import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";

// Persists across every route (header + footer); everything else — hero, form, output,
// history list — belongs to one route only. Session state and the sign-in/out calls
// live here (not in the roaster page) because the header needs them on every route, not
// just "/" — see CLAUDE.md's "Frontend structure" for why roaster-specific state stays
// local to the roaster route instead.
export default function Layout() {
  const [session, setSession] = useState(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const authRef = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  // Closes the panel the moment a session appears — covers both its own provider
  // buttons and the roaster page's separate inline locked-source prompt, which signs in
  // directly without ever opening this panel. Adjusted during render (React's own
  // pattern for "reset state when a prop changes") rather than in an effect, which would
  // cost an extra render pass for a synchronous setState call.
  const [prevSession, setPrevSession] = useState(session);
  if (session !== prevSession) {
    setPrevSession(session);
    if (session) setSignInOpen(false);
  }

  // Outside click / Escape close the panel, per the design.
  useEffect(() => {
    if (!signInOpen) return;
    function handlePointerDown(e) {
      if (authRef.current && !authRef.current.contains(e.target)) setSignInOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") setSignInOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [signInOpen]);

  async function signIn(provider) {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  const email = session?.user?.email ?? "";
  const userHandle = email ? `@${email.split("@")[0]}` : "";
  const userInitial = email ? email[0].toUpperCase() : "?";

  function navClass({ isActive }) {
    return `nav-item${isActive ? " is-active" : ""}`;
  }

  return (
    <div className="app-root">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Roastify</span>
        </div>

        <nav className="nav">
          <NavLink to="/" end className={navClass}>
            <span className="nav-item-bar" />
            roast
          </NavLink>
          <NavLink to="/history" className={navClass}>
            <span className="nav-item-bar" />
            history
          </NavLink>
        </nav>

        <div className="hspacer" />

        {isSupabaseConfigured ? (
          <div className="auth" ref={authRef}>
            {session ? (
              <>
                <span className="auth-user">
                  <span className="auth-avatar">{userInitial}</span>
                  <span className="auth-handle">{userHandle}</span>
                </span>
                <button type="button" className="auth-signout" onClick={signOut}>
                  sign out
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`auth-trigger${signInOpen ? " is-open" : ""}`}
                onClick={() => setSignInOpen((open) => !open)}
              >
                <span>sign in</span>
                <span className={`auth-caret${signInOpen ? " is-open" : ""}`}>&#9662;</span>
              </button>
            )}

            {signInOpen && !session && (
              <div className="signin-panel">
                <div className="signin-panel-head">
                  <span className="signin-panel-title">sign in</span>
                  <button type="button" className="signin-panel-close" onClick={() => setSignInOpen(false)}>
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
          </div>
        ) : (
          <div className="hmeta">
            <span className="hmeta-item">no login</span>
          </div>
        )}
      </header>

      <main className="app-main">
        <Outlet context={{ session, signIn, signOut, openSignIn: () => setSignInOpen(true) }} />
      </main>

      <footer className="footer">
        <div className="footer-name">Made by Sarthak Mohite</div>
        <div className="footer-spacer" />
        <div className="footer-brand">
          <span className="footer-brand-mark" />
          <span className="footer-brand-name">Roastify</span>
        </div>
      </footer>
    </div>
  );
}
