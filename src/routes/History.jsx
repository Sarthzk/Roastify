import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { getHistory, deleteRoast, startConversation } from "../lib/openai";
import { PERSONAS, personaName } from "../lib/personas";
import { formatDate } from "../lib/chatHelpers";
import { SEVERITY_LABELS, severityModifier } from "../lib/severity";
import { GithubIcon, LinkedinIcon, InstagramIcon, ResumeIcon } from "../components/PlatformIcons";
import SignInGate from "../components/SignInGate";
import VerdictCard from "../components/VerdictCard";
import { exportCardAsImage } from "../lib/exportCard";

const SOURCE_FILTERS = [
  { value: "github", label: "GitHub" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "resume", label: "Resume" },
  { value: "instagram", label: "Instagram" },
];

// `type` is the roast's real `type` field — looks up the matching icon component, never
// a fallback glyph implying a source that isn't real. Kept local (not a shared export
// from PlatformIcons.jsx) since mixing a component file's exports with a plain object
// breaks Vite Fast Refresh for it.
const PLATFORM_ICON = { github: GithubIcon, linkedin: LinkedinIcon, resume: ResumeIcon, instagram: InstagramIcon };

const SEARCH_DEBOUNCE_MS = 350;

// Signed-in only — a signed-out visitor gets the full-page sign-in gate, same as /chat
// (see SignInGate.jsx). Search + persona/source filters are real server-side filters
// (api/history.js) — they search the caller's entire history, not just whatever page
// is already loaded, so changing any of them re-fetches from scratch rather than
// filtering the in-memory list.
export default function History() {
  const { session, signIn } = useOutletContext();
  const navigate = useNavigate();
  const signedIn = Boolean(session);

  const [roasts, setRoasts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(signedIn);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [openingId, setOpeningId] = useState(null);
  const [openError, setOpenError] = useState(null);
  const [exportingId, setExportingId] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [personaFilter, setPersonaFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  // The roast currently being turned into an exported PNG — rendered as a hidden,
  // off-screen VerdictCard below (see handleExport) rather than a ref per visible row,
  // since only one export ever runs at a time.
  const [exportRoast, setExportRoast] = useState(null);
  const exportCardRef = useRef(null);

  const filters = {
    persona: personaFilter !== "all" ? personaFilter : undefined,
    type: sourceFilter !== "all" ? sourceFilter : undefined,
    q: debouncedSearch.trim() || undefined,
  };
  const filtersActive = Boolean(filters.persona || filters.type || filters.q);

  // Typing shouldn't fire a request per keystroke — wait for a short pause before it
  // becomes the real `q` filter below.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  // Same render-time-adjustment pattern ChatThread.jsx's own `key` comparison uses:
  // resets loading/error the instant the token or any real filter changes (a filter
  // change is a new query against the caller's whole history, not a page append, so
  // this always throws away `roasts`/`cursor` rather than reusing what's loaded) —
  // adjusted during render rather than inside the effect below, which would cost an
  // extra render pass for synchronous setState calls (and trips the lint rule for it).
  const fetchKey = `${session?.access_token}:${filters.persona}:${filters.type}:${filters.q}`;
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey);
  const latestFetchKey = useRef(fetchKey);
  useEffect(() => {
    latestFetchKey.current = fetchKey;
  });
  if (fetchKey !== prevFetchKey) {
    setPrevFetchKey(fetchKey);
    if (signedIn) {
      setLoading(true);
      setError(null);
    }
  }

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    getHistory(session.access_token, undefined, filters)
      .then((data) => {
        if (cancelled) return;
        setRoasts(data.roasts);
        setCursor(data.nextCursor);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, session?.access_token, filters.persona, filters.type, filters.q]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const requestedKey = fetchKey;
    try {
      const data = await getHistory(session.access_token, cursor, filters);
      // A filter/search change while this page was in flight already replaced the list —
      // appending this page (fetched under the old filters) would mix the two.
      if (latestFetchKey.current !== requestedKey) return;
      setRoasts((prev) => [...prev, ...data.roasts]);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleConfirmDelete(id) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteRoast(session.access_token, id);
      setRoasts((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }

  async function handleOpenChat(roastId) {
    setOpeningId(roastId);
    setOpenError(null);
    try {
      const conversation = await startConversation(session.access_token, roastId);
      navigate(`/chat/${conversation.id}`);
    } catch (err) {
      setOpenError(err.message);
      setOpeningId(null);
    }
  }

  // Reuses RoastCard.jsx's own VerdictCard/exportCardAsImage exactly, rather than a
  // second, chip-styled visual just for this one export — so a past roast's exported
  // card looks pixel-for-pixel like the one you already get right after roasting on
  // Home. Setting exportRoast renders the hidden card below (off-screen, at a fixed
  // width so it's portrait rather than as wide as this row) and the effect keyed on it
  // fires the actual capture once that render has committed.
  function handleExport(roast) {
    if (exportingId) return;
    setExportingId(roast.id);
    setExportRoast(roast);
  }

  useEffect(() => {
    if (!exportRoast) return;
    let cancelled = false;
    exportCardAsImage(exportCardRef.current, "roastify-verdict.png").finally(() => {
      if (!cancelled) {
        setExportingId(null);
        setExportRoast(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [exportRoast]);

  if (!signedIn) {
    return (
      <SignInGate
        signIn={signIn}
        title="Sign in to open the archive"
        copy="Every roast you run while signed in is kept here — source, voice, severity, the original verdict, and the fixes you were given. Sign in first and start the record."
      />
    );
  }

  return (
    <div className="roaster-studio">
      <section className="rs-hero">
        <span className="rs-hero-badge">&#128193; Critique Archive</span>
        <h1 className="rs-hero-title">Saved Verdicts</h1>
        <p className="rs-hero-copy">
          Every roast you have run, newest first. Reopen a rebuttal chat, export a
          verdict card, or clear one out for good.
        </p>
      </section>

      <div className="rs-page">
        <div className="rs-history-stack">
          <div className="rs-card">
            <div className="rs-field-head">
              <span className="rs-field-label">01. Filter &amp; search</span>
              {filtersActive && (
                <button
                  type="button"
                  className="rs-demo-btn"
                  onClick={() => {
                    setSearch("");
                    setDebouncedSearch("");
                    setPersonaFilter("all");
                    setSourceFilter("all");
                  }}
                >
                  reset filters
                </button>
              )}
            </div>
            <input
              type="text"
              className="rs-input"
              placeholder="Search by username, handle, or filename…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="rs-filter-row">
              <div className="rs-filter-group">
                <span className="rs-filter-label">Persona:</span>
                <button
                  type="button"
                  className={`rs-filter-pill${personaFilter === "all" ? " is-active" : ""}`}
                  onClick={() => setPersonaFilter("all")}
                >
                  All
                </button>
                {PERSONAS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`rs-filter-pill${personaFilter === p.value ? " is-active" : ""}`}
                    onClick={() => setPersonaFilter(p.value)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="rs-filter-group">
                <span className="rs-filter-label">Source:</span>
                <button
                  type="button"
                  className={`rs-filter-pill${sourceFilter === "all" ? " is-active" : ""}`}
                  onClick={() => setSourceFilter("all")}
                >
                  All
                </button>
                {SOURCE_FILTERS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`rs-filter-pill${sourceFilter === s.value ? " is-active" : ""}`}
                    onClick={() => setSourceFilter(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading && (
            <div className="rs-card">
              <span className="rs-idle-copy">loading…</span>
            </div>
          )}

          {!loading && error && (
            <div className="rs-card">
              <div className="rs-error">
                <div className="rs-error-top">
                  <span className="rs-error-icon">!</span>
                  <span className="rs-error-msg">Couldn't load your history.</span>
                </div>
                <span className="rs-error-detail">{error}</span>
              </div>
            </div>
          )}

          {!loading && !error && (
            <>
              {deleteError && <p className="rs-convo-error">Couldn't delete that roast — {deleteError}</p>}
              {openError && <p className="rs-convo-error">Couldn't open that conversation — {openError}</p>}

              {roasts.length === 0 && !filtersActive && (
                <div className="rs-card">
                  <div className="rs-idle">
                    <span className="rs-idle-icon">&#9678;</span>
                    <span className="rs-idle-title">Nothing here yet</span>
                    <p className="rs-idle-copy">
                      Your first roast lands here the moment it finishes — source, voice,
                      severity, and the verdict itself.
                    </p>
                  </div>
                </div>
              )}

              {roasts.length === 0 && filtersActive && (
                <div className="rs-card">
                  <div className="rs-idle">
                    <span className="rs-idle-icon">&#128269;</span>
                    <span className="rs-idle-title">No matches</span>
                    <p className="rs-idle-copy">Nothing in your history matches those filters.</p>
                  </div>
                </div>
              )}

              {roasts.map((r, i) => {
                const Icon = PLATFORM_ICON[r.type];
                const persona = PERSONAS.find((p) => p.value === r.persona);
                const isConfirming = confirmingId === r.id;
                return (
                  <article key={r.id} className="rs-docket">
                    <div className="rs-docket-capture">
                      <div className="rs-docket-meta">
                        <span className="rs-docket-num">{String(i + 1).padStart(2, "0")}</span>
                        {Icon && (
                          <span className="rs-docket-source">
                            <Icon />
                            {r.type}
                          </span>
                        )}
                        {r.identifier && <span className="rs-docket-identifier">{r.identifier}</span>}
                        <span className="rs-docket-persona">
                          <span className="rs-docket-persona-dot" />
                          {personaName(r.persona) ?? r.persona}
                        </span>
                        {r.severity && (
                          <span className={`rs-docket-severity rs-docket-severity--${severityModifier(r.severity)}`}>
                            {SEVERITY_LABELS[r.severity] ?? r.severity}
                          </span>
                        )}
                        <span className="rs-docket-time">{formatDate(r.created_at)}</span>
                      </div>

                      {r.roast && (
                        <div className="rs-original-verdict">
                          <span className="rs-original-verdict-tag">{persona?.verdictBadge ?? "Verdict"}</span>
                          <p className="rs-original-verdict-text">&#8220;{r.roast}&#8221;</p>
                        </div>
                      )}
                      {r.tips?.length > 0 && (
                        <div>
                          <span className="rs-docket-findings-label">Top fixes</span>
                          <div className="rs-docket-findings">
                            {r.tips.slice(0, 3).map((tip, ti) => (
                              <span key={ti} className="rs-docket-finding-chip">
                                {String(ti + 1).padStart(2, "0")}. {tip}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rs-docket-actions">
                      {isConfirming ? (
                        <div className="rs-convo-confirm">
                          <span className="rs-convo-confirm-text">Delete this roast? This can't be undone.</span>
                          <span className="rs-convo-confirm-actions">
                            <button
                              type="button"
                              className="rs-convo-confirm-yes"
                              onClick={() => handleConfirmDelete(r.id)}
                              disabled={deletingId === r.id}
                            >
                              {deletingId === r.id ? "deleting…" : "delete"}
                            </button>
                            <button type="button" className="rs-convo-confirm-cancel" onClick={() => setConfirmingId(null)}>
                              cancel
                            </button>
                          </span>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="rs-cta-btn rs-docket-cta"
                            onClick={() => handleOpenChat(r.id)}
                            disabled={openingId === r.id}
                          >
                            <span>{openingId === r.id ? "opening…" : "start rebuttal chat"}</span>
                            <span>&#8594;</span>
                          </button>
                          <div className="rs-docket-action-row">
                            <button
                              type="button"
                              className="rs-action-btn"
                              onClick={() => handleExport(r)}
                              disabled={exportingId === r.id}
                            >
                              {exportingId === r.id ? "generating…" : "export card"}
                            </button>
                            <button type="button" className="rs-action-btn rs-action-btn--danger" onClick={() => setConfirmingId(r.id)}>
                              delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}

              {cursor && (
                <button type="button" className="rs-convo-load-more" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "loading…" : "load more"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {exportRoast && (
        <div style={{ position: "fixed", top: 0, left: "-9999px", width: "520px" }}>
          <VerdictCard
            ref={exportCardRef}
            identifier={exportRoast.identifier}
            type={exportRoast.type}
            severity={exportRoast.severity}
            persona={exportRoast.persona}
            roast={exportRoast.roast}
            tips={exportRoast.tips}
          />
        </div>
      )}
    </div>
  );
}
