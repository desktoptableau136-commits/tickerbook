// Talks to the GitHub API from the browser so the dashboard can start a data update
// and show its real progress. The token lives only in this browser's localStorage.

const KEY = "stockdash.github";
const WORKFLOW = "update.yml";
const API = "https://api.github.com";

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

// Guess owner/repo from a GitHub Pages URL: https://<owner>.github.io/<repo>/
function guessRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return { owner: "", repo: "" };
  const seg = location.pathname.split("/").filter(Boolean)[0];
  return { owner: m[1], repo: seg || `${m[1]}.github.io` };
}

export function getConfig() {
  let c = {};
  try { c = JSON.parse(safeGet(KEY) || "{}"); } catch {}
  const g = guessRepo();
  return { owner: c.owner || g.owner, repo: c.repo || g.repo, token: c.token || "", branch: c.branch || "main" };
}

export function saveConfig(c) { safeSet(KEY, JSON.stringify(c)); }
export function clearToken() { const c = getConfig(); c.token = ""; saveConfig(c); }
export const connected = () => { const c = getConfig(); return !!(c.owner && c.repo && c.token); };

async function gh(path, { method = "GET", body, raw = false } = {}) {
  const c = getConfig();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = `GitHub said ${res.status}`;
    try { const j = await res.json(); if (j.message) msg += `: ${j.message}`; } catch {}
    const hint = res.status === 401 ? " Your token may be wrong or expired. Check Settings."
      : res.status === 403 ? " Your token may be missing the 'Actions: read and write' permission."
      : res.status === 404 ? " Check the repo name in Settings, and that the token has access to that repo." : "";
    const err = new Error(msg + hint); err.status = res.status; throw err;
  }
  if (res.status === 204) return null;
  return raw ? res.text() : res.json();
}

export async function testConnection() {
  const c = getConfig();
  const repo = await gh(`/repos/${c.owner}/${c.repo}`);
  await gh(`/repos/${c.owner}/${c.repo}/actions/workflows/${WORKFLOW}`);
  return repo.full_name;
}

// Read a file straight from the repo (skips the GitHub Pages republish delay).
export async function readRepoFile(path) {
  const c = getConfig();
  const txt = await gh(`/repos/${c.owner}/${c.repo}/contents/${path}?ref=${c.branch}&t=${Date.now()}`, { raw: true });
  return JSON.parse(txt);
}

// ---------------------------------------------------------------- tracked runs

// Stages shown in the progress bar. `weight` = share of the bar; `match` = workflow step names.
export const STAGES = [
  { id: "send", label: "Sending request to GitHub", weight: 4, expect: 2 },
  { id: "queue", label: "Waiting for a GitHub runner", weight: 18, expect: 15 },
  { id: "setup", label: "Setting up", weight: 22, expect: 20, match: ["Set up job", "Check out repo", "Set up Python", "Install dependencies"] },
  { id: "fetch", label: "Fetching data from Yahoo Finance", weight: 36, expect: 15, match: ["Fetch market data"] },
  { id: "save", label: "Saving to your repo", weight: 12, expect: 5, match: ["Save changes"] },
  { id: "load", label: "Loading results", weight: 8, expect: 2 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start a workflow run and report progress.
 * onProgress({ stage, stageIndex, percent, elapsed, runUrl }) is called often.
 * Resolves with { ok, message, runUrl }.
 */
export async function runUpdate({ action, ticker = "", tag = "researching", order = "" }, onProgress) {
  const c = getConfig();
  const requestId = Math.random().toString(36).slice(2, 10);
  const t0 = Date.now();
  let stageIndex = 0, stageStart = Date.now(), runUrl = null, stop = false;

  // Smoothly fill within the current stage (capped at 90% of it) so the bar never looks frozen,
  // but it only crosses into the next stage when GitHub reports that step finished.
  const tick = () => {
    const before = STAGES.slice(0, stageIndex).reduce((s, x) => s + x.weight, 0);
    const st = STAGES[stageIndex];
    const within = Math.min(0.9, (Date.now() - stageStart) / 1000 / (st.expect * 1.6));
    onProgress?.({ stage: st, stageIndex, percent: before + st.weight * within, elapsed: (Date.now() - t0) / 1000, runUrl });
  };
  const setStage = (i) => { if (i > stageIndex) { stageIndex = i; stageStart = Date.now(); } tick(); };
  const timer = setInterval(() => !stop && tick(), 250);

  try {
    tick();
    await gh(`/repos/${c.owner}/${c.repo}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      body: { ref: c.branch, inputs: { action, ticker, tag, order, request_id: requestId } },
    });
    setStage(1);

    // find our run by the [request id] in its name
    let run = null;
    for (let i = 0; i < 40 && !run; i++) {
      await sleep(i < 5 ? 1500 : 3000);
      const r = await gh(`/repos/${c.owner}/${c.repo}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=10`);
      run = (r.workflow_runs || []).find((x) => (x.name || x.display_title || "").includes(`[${requestId}]`));
    }
    if (!run) throw new Error("GitHub accepted the request but the run never showed up. Check the Actions tab on GitHub.");
    runUrl = run.html_url;

    // follow the fetch job's steps
    for (;;) {
      const jobs = await gh(`/repos/${c.owner}/${c.repo}/actions/runs/${run.id}/jobs`);
      const job = (jobs.jobs || []).find((j) => j.name === "fetch");
      if (job) {
        if (job.status !== "queued") setStage(2);
        for (let s = 2; s <= 4; s++) {
          const names = STAGES[s].match;
          const steps = (job.steps || []).filter((x) => names.includes(x.name));
          if (steps.some((x) => x.status !== "queued")) setStage(s);
        }
        if (job.status === "completed") {
          if (job.conclusion !== "success") {
            const failed = (job.steps || []).find((x) => x.conclusion === "failure");
            throw new Error(failed?.name === "Save changes"
              ? "The data was fetched but couldn't be saved, usually because another update was saving at the same moment. Try again."
              : `The update failed${failed ? ` at "${failed.name}"` : ""}. Yahoo may be rate-limiting; try again in a few minutes.`);
          }
          break;
        }
      }
      await sleep(2500);
    }

    setStage(5);
    let result = { ok: true, message: "Done." };
    try {
      const last = await readRepoFile("data/last_request.json");
      if (last.requestId === requestId) result = { ok: last.ok, message: last.message };
    } catch { /* refresh runs don't write last_request */ }
    onProgress?.({ stage: { label: result.ok ? "Done" : "Finished with a problem" }, stageIndex: STAGES.length, percent: 100, elapsed: (Date.now() - t0) / 1000, runUrl });
    return { ...result, runUrl };
  } finally {
    stop = true;
    clearInterval(timer);
  }
}
