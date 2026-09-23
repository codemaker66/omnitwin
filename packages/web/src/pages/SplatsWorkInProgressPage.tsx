import { useEffect, type ReactElement } from "react";
import { Link } from "react-router-dom";
import "./SplatsWorkInProgressPage.css";

export function SplatsWorkInProgressPage(): ReactElement {
  useEffect(() => {
    const previous = document.title;
    document.title = "Work in progress — Venviewer";
    return () => { document.title = previous; };
  }, []);

  return (
    <main className="splat-hold">
      <Link className="splat-hold__brand" to="/">Venviewer</Link>
      <section className="splat-hold__card" aria-labelledby="splat-hold-title">
        <p className="splat-hold__eyebrow">Gaussian splat viewer</p>
        <h1 id="splat-hold-title">Work in progress</h1>
        <p>We’re still refining this experience. Gaussian splat viewing is currently unavailable.</p>
        <div className="splat-hold__tour">
          <h2>Explore the virtual tour</h2>
          <p>Our panoramic walkthrough is available to try. It is also a work in progress.</p>
          <Link className="splat-hold__primary" to="/tour">Try the tour <span aria-hidden="true">↗</span></Link>
          <span className="splat-hold__status">Work in progress</span>
        </div>
        <Link className="splat-hold__back" to="/">Back to Venviewer</Link>
      </section>
    </main>
  );
}
