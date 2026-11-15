"use client";

import { FormEvent, useState } from "react";

type Severity = "High Risk" | "Low Risk" | "Info";
type Category = "Page" | "Hidden element" | "Third-party script" | "Tracking endpoint" | "Form";

type Finding = {
  id: string;
  category: Category;
  severity: Severity;
  description: string;
  selector?: string;
  source?: string;
};

type Inspection = {
  url: string;
  simulated: boolean;
  findings: Finding[];
  previewHtml?: string;
};

const PRESETS = [
  { label: "Checkout flow", url: "https://www.amazon.com/gp/buy/" },
  { label: "Affiliate review site", url: "https://www.nytimes.com/wirecutter/" },
  { label: "Pricing page", url: "https://stripe.com/pricing" }
];

// Each kind of finding is an encounter from the voyage home.
const ENCOUNTERS: Record<Category, string> = {
  "Hidden element": "Siren",
  "Tracking endpoint": "Cyclops",
  "Third-party script": "Stranger’s sail",
  Form: "Circe’s door",
  Page: "Landmark"
};

function voyage(findings: Finding[]) {
  const high = findings.filter((f) => f.severity === "High Risk").length;
  const low = findings.filter((f) => f.severity === "Low Risk").length;
  const hull = Math.max(0, 100 - high * 14 - low * 5);
  const rank = hull >= 85 ? "Calm seas" : hull >= 60 ? "Choppy water" : hull >= 35 ? "Stormy crossing" : "Shipwreck";
  const tone = hull >= 85 ? "calm" : hull >= 60 ? "choppy" : "storm";
  return { high, low, hull, rank, tone };
}

function severityClass(severity: Severity) {
  if (severity === "High Risk") return "tag tag-high";
  if (severity === "Low Risk") return "tag tag-low";
  return "tag tag-info";
}

function Eye({ scanning }: { scanning: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={scanning ? "eye eye-scanning" : "eye"}
      viewBox="0 0 240 140"
    >
      <defs>
        <clipPath id="eye-shape">
          <path d="M8 70C50 14 190 14 232 70C190 126 50 126 8 70Z" />
        </clipPath>
        <clipPath id="iris-shape">
          <circle cx="120" cy="70" r="40" />
        </clipPath>
      </defs>
      <path className="eye-white" d="M8 70C50 14 190 14 232 70C190 126 50 126 8 70Z" />
      <g clipPath="url(#eye-shape)">
        <g className="eye-iris">
          <circle className="iris-fill" cx="120" cy="70" r="40" />
          <g clipPath="url(#iris-shape)" className="iris-waves">
            <path d="M70 58q12-8 24 0t24 0t24 0t24 0t24 0" />
            <path d="M70 72q12-8 24 0t24 0t24 0t24 0t24 0" />
            <path d="M70 86q12-8 24 0t24 0t24 0t24 0t24 0" />
          </g>
          <circle className="pupil" cx="120" cy="70" r="13" />
          <circle className="glint" cx="126" cy="64" r="3.5" />
        </g>
      </g>
      <path className="eye-outline" d="M8 70C50 14 190 14 232 70C190 126 50 126 8 70Z" />
    </svg>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedFinding, setSelectedFinding] = useState("");

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entered = url.trim();
    if (!entered) {
      setError("Enter a website address to inspect.");
      return;
    }
    const candidate = /^https?:\/\//i.test(entered) ? entered : `https://${entered}`;

    setUrl(candidate);
    setError("");
    setInspection(null);
    setSelectedFinding("");
    setActiveUrl(candidate);
    setLoading(true);

    try {
      const response = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: candidate })
      });
      const result = (await response.json()) as Inspection & { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? `Inspection failed (${response.status}).`);
      }
      setInspection(result);
      setActiveUrl(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The inspection request failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const snapshot = Boolean(inspection?.previewHtml && !inspection.simulated);
  const score = inspection ? voyage(inspection.findings) : null;

  return (
    <main className="shell">
      <header className="top">
        <span className="wordmark">OdysSee</span>
        <span className="top-note">Public pages only. No cookies, no form data.</span>
      </header>

      <section className="hero">
        <Eye scanning={loading} />
        <h1>See through all.</h1>
        <p className="lede">Paste a website and OdysSee charts what hides beneath it.</p>

        <form className="search" onSubmit={analyze}>
          <label className="field">
            <span className="sr-only">Website address</span>
            <input
              autoComplete="url"
              onChange={(event) => setUrl(event.target.value)}
              placeholder="example.com"
              type="text"
              value={url}
            />
          </label>
          <button className="go" disabled={loading} type="submit">
            {loading ? "Inspecting…" : "Inspect site"}
          </button>
        </form>

        <div aria-label="Sample websites" className="presets">
          <span>Or try</span>
          {PRESETS.map((preset) => (
            <button
              aria-pressed={url === preset.url}
              key={preset.url}
              onClick={() => setUrl(preset.url)}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </section>

      <section aria-label="Inspection results" className="voyage">
        <div className="panel">
          <div className="panel-head">
            <h2>The page</h2>
            {activeUrl && (
              <a href={activeUrl} rel="noreferrer" target="_blank">
                Open in new tab
              </a>
            )}
          </div>
          <div className="frame">
            {activeUrl ? (
              <iframe
                key={`${activeUrl}:${snapshot ? "snapshot" : "live"}`}
                className="target-frame"
                referrerPolicy="no-referrer"
                sandbox={snapshot ? "" : "allow-scripts"}
                src={snapshot ? undefined : activeUrl}
                srcDoc={snapshot ? inspection?.previewHtml : undefined}
                title={snapshot ? "Read-only snapshot of the inspected site" : "Live preview of the inspected site"}
              />
            ) : (
              <p className="empty">
                <strong>{loading ? "Fetching the page…" : "No page yet"}</strong>
                {loading ? "Preparing a safe preview." : "Inspect a site and its preview appears here."}
              </p>
            )}
          </div>
          {activeUrl && (
            <p className="frame-note">
              {inspection?.simulated
                ? "Live preview. Findings are a simulation because the page could not be read."
                : snapshot
                  ? "Read-only snapshot of the page."
                  : "Live preview."}{" "}
              Some sites block previews.
            </p>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Encounters</h2>
            {inspection && <span className="count">{inspection.findings.length} found</span>}
          </div>

          {score && (
            <div className={`hull hull-${score.tone}`}>
              <div className="hull-top">
                <strong>{score.rank}</strong>
                <span>Hull {score.hull}%</span>
              </div>
              <div
                aria-label={`Hull integrity ${score.hull} percent`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={score.hull}
                className="hull-bar"
                role="meter"
              >
                <i style={{ width: `${score.hull}%` }} />
              </div>
              <p>
                {score.high} high risk, {score.low} low risk
              </p>
            </div>
          )}

          <div aria-live="polite" className="encounters">
            {inspection ? (
              inspection.findings.map((finding) => (
                <button
                  aria-pressed={selectedFinding === finding.id}
                  className="card"
                  key={finding.id}
                  onClick={() => setSelectedFinding(selectedFinding === finding.id ? "" : finding.id)}
                  type="button"
                >
                  <span className="card-top">
                    <span className="card-name">
                      {ENCOUNTERS[finding.category]}
                      <small>{finding.category}</small>
                    </span>
                    <span className={severityClass(finding.severity)}>{finding.severity}</span>
                  </span>
                  <span className="card-text">{finding.description}</span>
                  {finding.selector && <code>{finding.selector}</code>}
                  {finding.source && <code>{finding.source}</code>}
                </button>
              ))
            ) : (
              <p className="empty">
                <strong>{loading ? "Reading the page…" : "Calm waters"}</strong>
                {loading
                  ? "Looking for hidden elements, scripts, trackers and forms."
                  : "Hidden elements, trackers and forms will surface here."}
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
