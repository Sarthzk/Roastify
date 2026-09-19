import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { deleteAccount } from "../lib/openai";

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

// Every claim here is a real property of this app — the copy is carried over from the
// previous version of this page, only regrouped into the Stitch mockup's card layout
// (see WORK_LOG.md for what was dropped from the mockup and why). The "Deleting your
// data" claims are real, working controls: per-roast delete lives on each /history row
// (api/history.js's DELETE handler); account delete is the danger zone below, calling
// api/account.js, which deletes the auth user via the service role key — the roasts
// table's user_id foreign key is `on delete cascade`, so every roast attached to the
// account goes with it in the same operation.
export default function Privacy() {
  const { session, signOut, openSignIn } = useOutletContext();
  const signedIn = Boolean(session);
  const navigate = useNavigate();

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  // "Type DELETE MY ACCOUNT to unlock" — the extra typed step matches the weight of an
  // irreversible, whole-account action better than a second click does.
  const [confirmTyped, setConfirmTyped] = useState("");

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(session.access_token);
      await signOut();
      navigate("/");
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="roaster-studio">
      <section className="rs-hero rs-privacy-hero">
        <div>
          <span className="rs-hero-badge">&#128274; Data sovereignty</span>
          <h1 className="rs-hero-title">Privacy manifesto &amp; your data</h1>
          <p className="rs-hero-copy">
            Roastify is a joke generator with a real backend. Here is exactly what it does with
            your data.
          </p>
        </div>

        <div className="rs-card rs-privacy-glance">
          <span className="rs-field-label">At a glance</span>
          <div className="rs-privacy-glance-row">
            <span>Uploaded files</span>
            <strong>Never stored</strong>
          </div>
          <div className="rs-privacy-glance-row">
            <span>Scraped profile data</span>
            <strong>30 days, then purged</strong>
          </div>
          <div className="rs-privacy-glance-row">
            <span>Model training</span>
            <strong>None arranged</strong>
          </div>
          <div className="rs-privacy-glance-row">
            <span>Your session</span>
            <strong className={signedIn ? "is-on" : undefined}>{signedIn ? "Signed in" : "Anonymous"}</strong>
          </div>
        </div>
      </section>

      <div className="rs-page rs-privacy-stack">
        <section className="rs-privacy-section">
          <div className="rs-privacy-section-head">
            <span className="rs-privacy-tag">01</span>
            <h2 className="rs-privacy-section-title">What we take &amp; where it goes</h2>
          </div>
          <div className="rs-privacy-grid">
            <article className="rs-privacy-card">
              <span className="rs-privacy-card-title">What you give it</span>
              <p className="rs-privacy-copy">
                A profile link, or a PDF you upload. GitHub and Instagram profiles are fetched from
                public sources. LinkedIn profiles and resumes are read from the file you upload — the
                text is extracted in your browser and sent to our server to generate the roast.
              </p>
            </article>
            <article className="rs-privacy-card">
              <span className="rs-privacy-card-title">Where it goes</span>
              <p className="rs-privacy-copy">
                Profile text is sent to Groq, which runs the language model that writes the roast.
                Instagram profiles are fetched through Apify, a third-party scraping service. Neither
                is used to train anything — we do not have that arrangement with them, and their own
                terms apply to what they do with requests.
              </p>
            </article>
            <article className="rs-privacy-card">
              <span className="rs-privacy-card-title">Accounts</span>
              <p className="rs-privacy-copy">
                Signing in with GitHub or Google gives us your email, display name, and avatar.
                Nothing else. We cannot read your repositories, your email, or anything in your
                Google account. Authentication is handled by Supabase.
              </p>
            </article>
          </div>
        </section>

        <section className="rs-privacy-section">
          <div className="rs-privacy-section-head">
            <span className="rs-privacy-tag">02</span>
            <h2 className="rs-privacy-section-title">What we keep</h2>
          </div>
          <div className="rs-privacy-grid">
            <article className="rs-privacy-card">
              <div className="rs-privacy-card-head">
                <span>Channel A</span>
                <span className="rs-privacy-chip rs-privacy-chip--lime">Cached briefly</span>
              </div>
              <span className="rs-privacy-card-title">Scraped profiles</span>
              <p className="rs-privacy-copy">
                Scraped profile data is cached briefly to avoid re-fetching the same profile — one
                hour for GitHub, 24 hours for Instagram. After that it is gone from the cache.
              </p>
            </article>
            <article className="rs-privacy-card">
              <div className="rs-privacy-card-head">
                <span>Channel B</span>
                <span className="rs-privacy-chip rs-privacy-chip--lilac">Never stored</span>
              </div>
              <span className="rs-privacy-card-title">Uploads</span>
              <p className="rs-privacy-copy">
                <strong>Uploaded files are never stored.</strong> The PDF stays in your browser. Only
                the extracted text is sent, and only to generate the roast. Note that the roast itself
                may quote details from your resume, and roasts are stored — so anything you upload may
                end up in the stored roast text.
              </p>
            </article>
            <article className="rs-privacy-card">
              <div className="rs-privacy-card-head">
                <span>Channel C</span>
                <span className="rs-privacy-chip">Stored</span>
              </div>
              <span className="rs-privacy-card-title">Roasts</span>
              <p className="rs-privacy-copy">
                Roasts are stored: the source, the text, the tips, and which voice and severity you
                picked. If you are signed in, they are attached to your account and shown in your
                history. If you are not, they are stored without any identifier.
              </p>
              <p className="rs-privacy-copy">
                For GitHub and Instagram roasts specifically, the scraped profile data is also stored
                alongside the roast — this is what lets you keep chatting with the same voice
                afterward and have it reference real specifics (your actual repos, bio, captions)
                instead of just the roast text. It is deleted automatically after 30 days, and deleted
                immediately if you delete the roast or your account.
              </p>
            </article>
          </div>
        </section>

        <section className="rs-privacy-section">
          <div className="rs-privacy-section-head">
            <span className="rs-privacy-tag">03</span>
            <h2 className="rs-privacy-section-title">Your controls</h2>
          </div>
          <div className="rs-card rs-privacy-controls">
            <div className="rs-privacy-control">
              <div>
                <span className="rs-privacy-card-title">Delete a roast</span>
                <p className="rs-privacy-copy">
                  You can delete any roast from your history — each row has its own delete control.
                  Deleting a roast also removes any conversation started from it.
                </p>
              </div>
              <Link to="/history" className="rs-cta-btn rs-privacy-link-btn">
                <span>open history</span>
                <span>&#8594;</span>
              </Link>
            </div>
            <div className="rs-privacy-control">
              <div>
                <span className="rs-privacy-card-title">Roasting others</span>
                <p className="rs-privacy-copy">
                  Nothing stops you pasting somebody else's profile. Please do not. If something about
                  you has ended up here and you want it gone, get in touch.
                </p>
              </div>
            </div>
            <div className="rs-privacy-control">
              <div>
                <span className="rs-privacy-card-title">Contact</span>
                <p className="rs-privacy-copy">
                  <a className="rs-privacy-link-button" href="mailto:mohitesarthak74@gmail.com">
                    mohitesarthak74@gmail.com
                  </a>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rs-privacy-danger">
          <div className="rs-privacy-danger-head">
            <h2 className="rs-privacy-danger-title">&#9888; Danger zone: delete account</h2>
            <span className="rs-privacy-danger-tag">Irreversible</span>
          </div>
          <p className="rs-privacy-copy">
            Deleting your account removes every roast attached to it, along with their chat
            conversations. This can't be undone.
          </p>

          {!signedIn && (
            <p className="rs-privacy-copy">
              <button type="button" className="rs-privacy-link-button" onClick={openSignIn}>
                Sign in
              </button>{" "}
              to manage or delete your account.
            </p>
          )}

          {signedIn && (
            <div className="rs-privacy-unlock">
              <label className="rs-privacy-unlock-field">
                <span className="rs-field-label">
                  Type &ldquo;{CONFIRM_PHRASE}&rdquo; to unlock
                </span>
                <input
                  type="text"
                  className="rs-input"
                  placeholder={CONFIRM_PHRASE}
                  value={confirmTyped}
                  onChange={(e) => setConfirmTyped(e.target.value)}
                  disabled={deleting}
                  autoComplete="off"
                  spellCheck="false"
                />
              </label>
              <button
                type="button"
                className="rs-privacy-wipe-btn"
                onClick={handleDeleteAccount}
                disabled={deleting || confirmTyped !== CONFIRM_PHRASE}
              >
                {deleting ? "deleting…" : "delete my account"}
              </button>
            </div>
          )}

          {deleteError && <p className="rs-convo-error">Couldn't delete your account — {deleteError}</p>}
        </section>
      </div>
    </div>
  );
}
