"use client";

import { FormEvent, useMemo, useState } from "react";

type Severity = "High Risk" | "Low Risk" | "Info";

type Finding = {
  id: string;
  category: "Page" | "Hidden element" | "Third-party script" | "Tracking endpoint" | "Form";
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
  { label: "Simulated checkout flow", url: "https://www.amazon.com/gp/buy/" },
  { label: "Affiliate-heavy review site", url: "https://www.nytimes.com/wirecutter/" },
  { label: "SaaS pricing page", url: "https://stripe.com/pricing" }
];

function Icon({
  name,
  className
}: {
  name: "eye" | "scan" | "lock" | "globe" | "activity" | "loader" | "shield" | "external";
  className?: string;
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    eye: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    scan: (
      <>
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M4 12h16M12 4v16" />
      </>
    ),
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
      </>
    ),
    activity: (
      <>
        <path d="M3 12h4l3-8 4 16 3-8h4" />
      </>
    ),
    loader: <path d="M12 2a10 10 0 1 0 10 10" />,
    shield: (
      <>
        <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7M10 14 21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </>
    )
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function severityClass(severity: Severity) {
  if (severity === "High Risk") return "severity severity-high";
  if (severity === "Low Risk") return "severity severity-low";
  return "severity severity-info";
}

function eventIcon(category: Finding["category"]) {
  if (category === "Third-party script" || category === "Tracking endpoint") return "external";
  if (category === "Hidden element") return "eye";
  if (category === "Form") return "lock";
  return "globe";
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedFinding, setSelectedFinding] = useState("");

  const hiddenFindings = useMemo(
    () => inspection?.findings.filter((finding) => finding.category === "Hidden element") ?? [],
    [inspection]
  );

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entered = url.trim();
    if (!entered) {
      setError("Enter a website URL before analyzing.");
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
      setError(caught instanceof Error ? caught.message : "The inspection request failed.");
    } finally {
      setLoading(false);
    }
  }

  function choosePreset(presetUrl: string) {
    setUrl(presetUrl);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="wordmark">
          <span className="mark">
            <Icon name="eye" />
          </span>
          <span>OdysSee</span>
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow">A clearer view of the web</div>
        <h1>Inspect a website.</h1>
        <p className="hero-copy">
          Enter a URL or choose a sample, then inspect its preview and hidden page activity.
        </p>
      </section>

      <form className="controls" onSubmit={analyze}>
        <label className="url-field">
          <Icon name="globe" />
          <span className="sr-only">Website URL</span>
          <input
            autoComplete="url"
            className="url-input"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste a website URL to inspect"
            type="text"
            value={url}
          />
        </label>
        <div aria-label="Sample website presets" className="preset-strip">
          <span className="preset-heading">Try a sample</span>
          {PRESETS.map((preset) => (
            <button
              aria-pressed={url === preset.url}
              className="preset-button"
              key={preset.url}
              onClick={() => choosePreset(preset.url)}
              type="button"
            >
              <span>{preset.label}</span>
              <span className="preset-domain">{new URL(preset.url).hostname}</span>
            </button>
          ))}
        </div>
        <button className="analyze-button" disabled={loading} type="submit">
          <Icon className={loading ? "spinner" : undefined} name={loading ? "loader" : "scan"} />
          <span className="button-label">{loading ? "Inspecting…" : "Analyze Live DOM & Packets"}</span>
        </button>
      </form>
      <p className="privacy-note">
        <Icon name="shield" /> Only public HTTP(S) pages are fetched. Form values and cookies are
        never collected.
      </p>
      {error && <div className="notice error" role="alert">{error}</div>}

      <section aria-label="Inspection workspace" className="workspace">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <span className="panel-icon"><Icon name="eye" /></span>
              <span className="panel-title">X-Ray viewport</span>
            </div>
            {activeUrl ? (
              <a
                className="panel-caption viewport-link"
                href={activeUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open page ↗
              </a>
            ) : (
              <span className="panel-caption">Preview</span>
            )}
          </div>
          <div className="viewport-toolbar">
            <span className="browser-dots"><i /><i /><i /></span>
            <span>{activeUrl || "Waiting for a page…"}</span>
            <Icon name="lock" />
          </div>
          <div className="frame-wrap">
            {activeUrl ? (
              <iframe
                key={`${activeUrl}:${inspection?.previewHtml && !inspection.simulated ? "snapshot" : "live"}`}
                className="target-frame"
                referrerPolicy="no-referrer"
                sandbox={inspection?.previewHtml && !inspection.simulated ? "" : "allow-scripts"}
                src={inspection?.previewHtml && !inspection.simulated ? undefined : activeUrl}
                srcDoc={
                  inspection?.previewHtml && !inspection.simulated
                    ? inspection.previewHtml
                    : undefined
                }
                title={
                  inspection?.previewHtml && !inspection.simulated
                    ? "Sanitized read-only snapshot of inspected website"
                    : "Live preview of inspected website"
                }
              />
            ) : (
              <div className="frame-empty">
                <span className="frame-empty-icon"><Icon name="scan" /></span>
                <strong>{loading ? "Fetching a page preview…" : "Your viewport is ready"}</strong>
                <span>
                  {loading
                    ? "The inspector is fetching public HTML and preparing a page view."
                    : "Enter a URL or choose a preset to load the page in the isolated viewport."}
                </span>
              </div>
            )}
            {activeUrl && (
              <div className="frame-status">
                <Icon name="eye" />
                <span>
                  {inspection?.simulated
                    ? "Live preview · sample findings are simulated"
                    : inspection?.previewHtml
                      ? "Sanitized HTML snapshot · read only"
                      : loading
                        ? "Loading live preview…"
                        : "Live preview"}
                </span>
              </div>
            )}
          </div>
          <div className="inspection-strip">
            <div className="inspection-heading">
              <span>Hidden selectors</span>
              <span className="inspection-count">{hiddenFindings.length} detected</span>
            </div>
            <div className="selector-list">
              {hiddenFindings.length ? (
                hiddenFindings.map((finding) => (
                  <button
                    aria-pressed={selectedFinding === finding.id}
                    className="selector-chip"
                    key={finding.id}
                    onClick={() => setSelectedFinding(finding.id)}
                    title={finding.description}
                    type="button"
                  >
                    {finding.selector ?? finding.description}
                  </button>
                ))
              ) : (
                <span className="selector-empty">
                  {inspection ? "No hidden selectors found in the returned HTML." : "Run an inspection to surface hidden elements."}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <span className="panel-icon"><Icon name="activity" /></span>
              <span className="panel-title">Behind the page</span>
            </div>
          </div>
          <div aria-live="polite" className="event-list">
            {inspection ? (
              inspection.findings.map((finding) => (
                <article
                  className="event-card"
                  key={finding.id}
                  onClick={() => setSelectedFinding(finding.id)}
                  style={selectedFinding === finding.id ? { borderColor: "#d97706" } : undefined}
                >
                  <div className="event-topline">
                    <div className="event-kind">
                      <Icon name={eventIcon(finding.category)} />
                      {finding.category}
                    </div>
                    <span className={severityClass(finding.severity)}>{finding.severity}</span>
                  </div>
                  <p className="event-description">{finding.description}</p>
                  {finding.selector && <code className="event-selector">{finding.selector}</code>}
                  {finding.source && <code className="event-selector">{finding.source}</code>}
                </article>
              ))
            ) : (
              <div className="stream-empty">
                <Icon name="activity" />
                <strong>{loading ? "Reading the page…" : "Nothing hidden. Yet."}</strong>
                <span>
                  {loading
                    ? "Checking public HTML for concealed elements, outbound scripts, trackers, and forms."
                    : "Run an inspection to turn the page’s public HTML into a chronological, human-readable event stream."}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      <p className="disclaimer">
        Some sites block previews. Choose “Open page” to view one separately.
      </p>
      <footer className="footer-note">
        <span>ODYSSEE / WEB INSPECTION STUDIO</span>
        <span>Public HTML only · no cookies · no form submission</span>
      </footer>
    </main>
  );
}
