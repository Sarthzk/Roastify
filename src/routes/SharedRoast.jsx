import { useParams, Link } from "react-router-dom";

// Route + page shell only — no slug generation, no visibility logic, no sharing flow yet
// (see ROASTIFY_TASKS.md, next task). There's no backend to resolve `:slug` against, so
// this renders an honest "not available yet" state rather than fake sample content, with
// the same growth-loop CTA the finished page will keep once real roasts land here.
export default function SharedRoast() {
  const { slug } = useParams();

  return (
    <div>
      <section className="row">
        <div className="row-label row-label--accent">Roast</div>
        <div className="share-body">
          <div className="invitation-top">
            <span className="invitation-icon">&#8226;</span>
            <span className="invitation-msg">This roast isn't shareable yet.</span>
          </div>
          <p className="share-placeholder-copy">
            Public roast links (roastify.app/r/{slug}) are coming — for now, run your own.
          </p>
        </div>
      </section>

      <section className="cta">
        <div className="cta-label">Your profile is saying something too. Find out what.</div>
        <Link to="/" className="cta-button">
          roast me instead<span>&#8594;</span>
        </Link>
        <div className="cta-note">3 free a day · no account needed</div>
      </section>
    </div>
  );
}
