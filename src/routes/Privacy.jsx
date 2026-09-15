import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { deleteAccount } from "../lib/openai";

// The copy here is close to verbatim from the source doc — see WORK_LOG.md for the one
// thing that changed and why. The "Deleting your data" claims (per-roast delete, account
// delete) are real, working controls, not just text: per-roast delete lives on each
// /history row (api/history.js's DELETE handler); account delete is the confirm flow
// below, calling api/account.js, which deletes the auth user via the service role key —
// the roasts table's user_id foreign key is `on delete cascade`, so every roast attached
// to the account goes with it in the same operation.
export default function Privacy() {
  const { session, signOut, openSignIn } = useOutletContext();
  const signedIn = Boolean(session);
  const navigate = useNavigate();

  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

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
    <div>
      <section className="hero">
        <div className="hero-main">
          <h1 className="hero-title hero-title--small">Privacy</h1>
          <div className="hero-rule hero-rule--small" />
          <p className="hero-copy">
            Roastify is a joke generator with a real backend. Here is exactly what it does with your data.
          </p>
        </div>
      </section>

      <section className="row">
        <div className="row-label">What you give it</div>
        <div className="privacy-body">
          <p className="privacy-copy">
            A profile link, or a PDF you upload. GitHub and Instagram profiles are fetched from public
            sources. LinkedIn profiles and resumes are read from the file you upload — the text is extracted
            in your browser and sent to our server to generate the roast.
          </p>
        </div>
      </section>

      <section className="row">
        <div className="row-label">Where it goes</div>
        <div className="privacy-body">
          <p className="privacy-copy">
            Profile text is sent to Groq, which runs the language model that writes the roast. Instagram
            profiles are fetched through Apify, a third-party scraping service. Neither is used to train
            anything — we do not have that arrangement with them, and their own terms apply to what they do
            with requests.
          </p>
        </div>
      </section>

      <section className="row">
        <div className="row-label">What we keep</div>
        <div className="privacy-body">
          <p className="privacy-copy">
            Scraped profile data is cached briefly to avoid re-fetching the same profile — one hour for
            GitHub, 24 hours for Instagram. After that it is gone from the cache.
          </p>
          <p className="privacy-copy">
            Roasts are stored: the source, the text, the tips, and which voice and severity you picked. If
            you are signed in, they are attached to your account and shown in your history. If you are not,
            they are stored without any identifier.
          </p>
          <p className="privacy-copy">
            For GitHub and Instagram roasts specifically, the scraped profile data is also stored alongside
            the roast — this is what lets you keep chatting with the same voice afterward and have it
            reference real specifics (your actual repos, bio, captions) instead of just the roast text. It
            is deleted automatically after 30 days, and deleted immediately if you delete the roast or your
            account.
          </p>
        </div>
      </section>

      <section className="row">
        <div className="row-label">Uploads</div>
        <div className="privacy-body">
          <p className="privacy-copy">
            <strong>Uploaded files are never stored.</strong> The PDF stays in your browser. Only the
            extracted text is sent, and only to generate the roast. Note that the roast itself may quote
            details from your resume, and roasts are stored — so anything you upload may end up in the
            stored roast text.
          </p>
        </div>
      </section>

      <section className="row">
        <div className="row-label">Accounts</div>
        <div className="privacy-body">
          <p className="privacy-copy">
            Signing in with GitHub or Google gives us your email, display name, and avatar. Nothing else. We
            cannot read your repositories, your email, or anything in your Google account. Authentication is
            handled by Supabase.
          </p>
        </div>
      </section>

      <section className="row">
        <div className="row-label row-label--accent">Deleting your data</div>
        <div className="privacy-body">
          <p className="privacy-copy">
            You can delete any roast from your <Link to="/history">history</Link> — each row has its own
            delete control. Deleting your account below removes every roast attached to it.
          </p>

          {!signedIn && (
            <p className="privacy-copy">
              <button type="button" className="privacy-link-button" onClick={openSignIn}>
                Sign in
              </button>{" "}
              to manage or delete your account.
            </p>
          )}

          {signedIn && !confirming && (
            <button type="button" className="privacy-delete-button" onClick={() => setConfirming(true)}>
              delete my account
            </button>
          )}

          {signedIn && confirming && (
            <div className="privacy-confirm">
              <span className="hist-row-confirm-text">
                This permanently deletes your account and every roast on it. This can't be undone.
              </span>
              <span className="hist-row-confirm-actions">
                <button type="button" className="hist-row-confirm-yes" onClick={handleDeleteAccount} disabled={deleting}>
                  {deleting ? "deleting…" : "yes, delete everything"}
                </button>
                <button
                  type="button"
                  className="hist-row-confirm-cancel"
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                >
                  cancel
                </button>
              </span>
            </div>
          )}

          {deleteError && <p className="privacy-error">Couldn't delete your account — {deleteError}</p>}
        </div>
      </section>

      <section className="row">
        <div className="row-label">Roasting others</div>
        <div className="privacy-body">
          <p className="privacy-copy">
            Nothing stops you pasting somebody else's profile. Please do not. If something about you has
            ended up here and you want it gone, get in touch.
          </p>
        </div>
      </section>

      <section className="row">
        <div className="row-label">Contact</div>
        <div className="privacy-body">
          <p className="privacy-copy">[Sarthak's contact — fill this in]</p>
        </div>
      </section>
    </div>
  );
}
