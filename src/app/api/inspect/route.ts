import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as cheerio from "cheerio";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8_000;

type Severity = "High Risk" | "Low Risk" | "Info";
type Category =
  | "Page"
  | "Hidden element"
  | "Third-party script"
  | "Tracking endpoint"
  | "Form";

type Finding = {
  id: string;
  category: Category;
  severity: Severity;
  description: string;
  selector?: string;
  source?: string;
};

type InspectionResponse = {
  url: string;
  simulated: boolean;
  findings: Finding[];
  previewHtml?: string;
};

type LookupAddress = { address: string; family: number };
type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

function normalizePublicHost(hostname: string) {
  const address = hostname.replace(/^\[|\]$/g, "");
  const version = isIP(address);
  if (version) {
    const parsed = ipaddr.process(address);
    if (parsed.range() !== "unicast") {
      throw new Error("The requested address is not a public unicast IP.");
    }
    return;
  }

  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local and reserved hostnames cannot be inspected.");
  }
}

function validateTarget(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("Provide a URL shorter than 2,049 characters.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid absolute HTTP(S) URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be inspected.");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials cannot be inspected.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new Error("Only standard HTTP and HTTPS ports are allowed.");
  }
  if ((url.protocol === "http:" && url.port === "443") || (url.protocol === "https:" && url.port === "80")) {
    throw new Error("The URL port does not match its protocol.");
  }

  normalizePublicHost(url.hostname);
  return url;
}

function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

function createPinnedAgent() {
  return new Agent({
    connect: {
      lookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
        normalizePublicHost(hostname);
        lookup(hostname, { all: true, verbatim: true })
          .then((addresses) => {
            if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
              const error = Object.assign(new Error("The target resolves to a non-public IP address."), {
                code: "EACCES"
              }) as NodeJS.ErrnoException;
              callback(error, options.all ? [] : "", 0);
              return;
            }

            const resolved = addresses[0];
            callback(
              null,
              options.all ? addresses : resolved.address,
              options.all ? undefined : resolved.family
            );
          })
          .catch((error: NodeJS.ErrnoException) => {
            callback(error, options.all ? [] : "", 0);
          });
      }
    }
  });
}

async function fetchPublicHtml(initialUrl: URL) {
  let currentUrl = initialUrl;
  const dispatcher = createPinnedAgent();
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetch(currentUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9",
          "User-Agent": "OdysSee-Inspector/1.0"
        },
        redirect: "manual",
        signal,
        ...({ dispatcher } as RequestInit & { dispatcher: Agent })
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("The target returned a redirect without a location.");
        if (redirects === MAX_REDIRECTS) throw new Error("The target exceeded the redirect limit.");
        currentUrl = validateTarget(new URL(location, currentUrl).toString());
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`The target returned HTTP ${response.status}.`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
        await response.body?.cancel();
        throw new Error("The target did not return an HTML document.");
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
        await response.body?.cancel();
        throw new Error("The HTML document exceeds the 1 MB inspection limit.");
      }
      if (!response.body) throw new Error("The target returned an empty response.");

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_HTML_BYTES) {
          await reader.cancel();
          throw new Error("The HTML document exceeds the 1 MB inspection limit.");
        }
        chunks.push(value);
      }

      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const html = new TextDecoder().decode(bytes);
      return { html, finalUrl: currentUrl.toString() };
    }
    throw new Error("The target exceeded the redirect limit.");
  } finally {
    await dispatcher.close();
  }
}

function findHiddenElements($: cheerio.CheerioAPI) {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  function add(selector: string, reason: string, highRisk = false) {
    const key = `${selector}:${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      id: `hidden-${findings.length + 1}`,
      category: "Hidden element",
      severity: highRisk ? "High Risk" : "Low Risk",
      description: reason,
      selector
    });
  }

  $("[hidden], [style], iframe").each((index, element) => {
    const node = $(element);
    if (element.type !== "tag") return;
    const tag = element.name.toLowerCase();
    const selector = node.attr("id")
      ? `#${node.attr("id")}`
      : node.attr("class")
        ? `${tag}.${node.attr("class")!.trim().split(/\s+/).join(".")}`
        : `${tag}:nth-of-type(${index + 1})`;
    const style = node.attr("style") ?? "";
    const isZeroWidthFrame =
      tag === "iframe" &&
      ([node.attr("width"), node.attr("height")].some(
        (value) => value !== undefined && /^\s*0(?:px)?\s*$/i.test(value)
      ) || /(?:width|height)\s*:\s*0(?:px)?(?:\s*!important)?(?:\s*;|$)/i.test(style));

    if (node.attr("hidden") !== undefined) add(selector, "The element is marked hidden in the HTML.");
    if (/display\s*:\s*none(?:\s*!important)?/i.test(style)) {
      add(selector, "Inline CSS sets display: none.");
    }
    if (/opacity\s*:\s*0(?:\.0+)?(?:\s*!important)?(?:\s*;|$)/i.test(style)) {
      add(selector, "Inline CSS makes the element fully transparent.");
    }
    if (/font-size\s*:\s*0(?:px|em|rem|%)?(?:\s*!important)?(?:\s*;|$)/i.test(style)) {
      add(selector, "Inline CSS reduces the text size to zero.");
    }
    if (isZeroWidthFrame) add(selector, "An iframe has a zero width or height.", true);
  });

  $("style").each((_, styleElement) => {
    const css = $(styleElement).text();
    const rules = css.matchAll(/([^{}]+)\{([^{}]+)\}/g);
    for (const [, selectorText, declarationText] of rules) {
      const hiddenByRule =
        /display\s*:\s*none|opacity\s*:\s*0(?:\.0+)?|font-size\s*:\s*0(?:px|em|rem|%)?/i.test(
          declarationText
        );
      if (!hiddenByRule) continue;

      for (const selector of selectorText.split(",").map((item) => item.trim()).filter(Boolean)) {
        try {
          const matches = $(selector);
          matches.each((index, element) => {
            if (element.type !== "tag") return;
            const tag = element.name.toLowerCase();
            const displaySelector = $(element).attr("id")
              ? `#${$(element).attr("id")}`
              : `${tag}:nth-of-type(${index + 1})`;
            add(displaySelector, `A page stylesheet hides elements matched by ${selector}.`);
          });
        } catch {
          findings.push({
            id: `css-note-${findings.length + 1}`,
            category: "Page",
            severity: "Info",
            description: `A stylesheet selector could not be inspected: ${selector.slice(0, 100)}.`
          });
        }
      }
    }
  });

  return findings;
}

function extractFindings(html: string, targetUrl: URL) {
  const $ = cheerio.load(html);
  const findings: Finding[] = [
    {
      id: "page-fetched",
      category: "Page",
      severity: "Info",
      description: `Fetched and parsed the public HTML for ${targetUrl.hostname}.`
    }
  ];
  findings.push(...findHiddenElements($));

  $("script[src]").each((_, element) => {
    const source = $(element).attr("src");
    if (!source) return;
    const resolved = new URL(source, targetUrl);
    if (resolved.hostname.toLowerCase() === targetUrl.hostname.toLowerCase()) return;

    const tracker = /analytics|pixel|collect|track|beacon|gtag|doubleclick|facebook/i.test(
      `${resolved.hostname}${resolved.pathname}`
    );
    findings.push({
      id: `script-${findings.length + 1}`,
      category: tracker ? "Tracking endpoint" : "Third-party script",
      severity: tracker ? "High Risk" : "Low Risk",
      description: tracker
        ? `A third-party script points to a likely tracking service on ${resolved.hostname}.`
        : `The page loads executable JavaScript from another domain: ${resolved.hostname}.`,
      selector: "script[src]",
      source: resolved.origin + resolved.pathname
    });
  });

  $("img[src], iframe[src]").each((_, element) => {
    const node = $(element);
    const source = node.attr("src");
    if (!source) return;
    const resolved = new URL(source, targetUrl);
    const isPixel =
      node.is("img") &&
      ([node.attr("width"), node.attr("height")].some(
        (value) => value !== undefined && /^\s*1(?:px)?\s*$/i.test(value)
      ) || /(?:width|height)\s*:\s*1(?:px)?(?:\s*!important)?(?:\s*;|$)/i.test(node.attr("style") ?? ""));
    const tracker = isPixel || /pixel|collect|track|beacon|analytics/i.test(resolved.href);
    if (!tracker) return;
    findings.push({
      id: `endpoint-${findings.length + 1}`,
      category: "Tracking endpoint",
      severity: "High Risk",
      description: `A ${isPixel ? "small image" : "resource"} request may report page activity to ${resolved.hostname}.`,
      selector: node.is("img") ? "img[src]" : "iframe[src]",
      source: resolved.origin + resolved.pathname
    });
  });

  $("form").each((index, element) => {
    const form = $(element);
    const action = form.attr("action");
    const resolvedAction = action ? new URL(action, targetUrl) : targetUrl;
    const parameters = form
      .find('input[type="hidden"][name]')
      .map((_, input) => $(input).attr("name"))
      .get()
      .filter((name): name is string => Boolean(name));
    findings.push({
      id: `form-${index + 1}`,
      category: "Form",
      severity: parameters.length ? "Low Risk" : "Info",
      description: parameters.length
        ? `A form submits to ${resolvedAction.hostname} with ${parameters.length} hidden parameter${parameters.length === 1 ? "" : "s"}; their values are not collected.`
        : `A form submits to ${resolvedAction.hostname}; submitted values are not collected.`,
      selector: form.attr("id") ? `form#${form.attr("id")}` : `form:nth-of-type(${index + 1})`,
      source: resolvedAction.origin + resolvedAction.pathname
    });
  });

  return findings;
}

function createSafePreview(html: string, targetUrl: URL) {
  const $ = cheerio.load(html);
  $("script, style, link, iframe, frame, object, embed, base, meta").remove();
  $("form").each((_, form) => {
    $(form).replaceWith($(form).contents());
  });
  $("input, select, textarea, button").remove();

  $("*").each((_, element) => {
    if (element.type !== "tag") return;
    const node = $(element);
    for (const [attribute, value] of Object.entries(element.attribs)) {
      if (typeof value !== "string") continue;
      const name = attribute.toLowerCase();
      if (name.startsWith("on") || ["style", "srcdoc", "srcset", "action", "formaction"].includes(name)) {
        node.removeAttr(attribute);
        continue;
      }

      if (!["href", "src", "poster", "cite", "xlink:href"].includes(name)) continue;
      try {
        const resolved = new URL(value, targetUrl);
        const permittedHrefScheme = name === "href" && ["mailto:", "tel:"].includes(resolved.protocol);
        if (resolved.protocol !== "http:" && resolved.protocol !== "https:" && !permittedHrefScheme) {
          node.removeAttr(attribute);
        } else {
          node.attr(attribute, resolved.toString());
        }
      } catch {
        node.removeAttr(attribute);
      }
    }
  });

  const content = $("body").html() ?? "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    *{box-sizing:border-box}body{margin:0;padding:24px;color:#0f172a;background:#fff;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main,article,section{max-width:920px;margin-inline:auto}h1,h2,h3{line-height:1.2;color:#111827}a{color:#b45309;text-decoration:underline}img,video{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}th,td{padding:7px;border:1px solid #e2e8f0;text-align:left}blockquote{margin-inline:0;padding:10px 16px;border-left:3px solid #d97706;background:#fafaf9}pre{max-width:100%;overflow:auto;padding:12px;background:#f1f5f9}
  </style></head><body>${content}</body></html>`;
}

function simulatedInspection(url: URL): InspectionResponse {
  return {
    url: url.toString(),
    simulated: true,
    findings: [
      {
        id: "simulated-page",
        category: "Page",
        severity: "Info",
        description: `The live HTML for ${url.hostname} was unavailable; sample signals are shown below.`
      },
      {
        id: "simulated-hidden",
        category: "Hidden element",
        severity: "Low Risk",
        description: "Simulation: a hidden consent container could contain interface state.",
        selector: "#consent-details"
      },
      {
        id: "simulated-tracker",
        category: "Tracking endpoint",
        severity: "High Risk",
        description: "Simulation: a tracking request might report a page view to an analytics service.",
        selector: "script[src]"
      },
      {
        id: "simulated-form",
        category: "Form",
        severity: "Info",
        description: "Simulation: a checkout form could submit to the same site. No values were read.",
        selector: "form"
      }
    ]
  };
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const inputUrl = payload && typeof payload === "object" ? (payload as { url?: unknown }).url : undefined;
  let url: URL;
  try {
    url = validateTarget(inputUrl);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The URL is not allowed." },
      { status: 400 }
    );
  }

  try {
    const { html, finalUrl } = await fetchPublicHtml(url);
    const finalTarget = validateTarget(finalUrl);
    const findings = extractFindings(html, finalTarget);
    const result: InspectionResponse = {
      url: finalUrl,
      simulated: false,
      findings,
      previewHtml: createSafePreview(html, finalTarget)
    };
    return Response.json(result);
  } catch {
    const simulated = simulatedInspection(url);
    return Response.json(simulated);
  }
}
