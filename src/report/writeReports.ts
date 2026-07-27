import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "../runner/JourneyRunner.js";
import type { ExpectedEvent, NormalizedEvent } from "../normalize/types.js";
import { buildDiffLines } from "../verify/EventVerifier.js";
import { diagnoseFailure } from "../diagnose/diagnoseFailure.js";
import { diagnosisLabel } from "../diagnose/labels.js";
import type { DiagnosisResult } from "../diagnose/types.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function propDiff(expected: ExpectedEvent, actual: NormalizedEvent): string {
  return buildDiffLines(expected, actual);
}

function formatExpected(expected: ExpectedEvent): string {
  const out: Record<string, unknown> = {};
  if (expected.properties !== undefined) out.properties = expected.properties;
  if (expected.fields !== undefined) out.fields = expected.fields;
  return JSON.stringify(out, null, 2);
}

function formatActual(actual: NormalizedEvent): string {
  return JSON.stringify(
    { properties: actual.properties, fields: actual.fields },
    null,
    2,
  );
}

function buildHtml(
  result: RunResult,
  runId: string,
  screenshotPath?: string,
  diagnosis?: DiagnosisResult,
): string {
  const status = result.pass ? "PASS" : "FAIL";
  const statusColor = result.pass ? "#0a7a32" : "#b00020";

  const matchedRows = result.verification.matched
    .map(
      (m) => `
      <tr>
        <td>matched</td>
        <td><code>${escapeHtml(m.expected.eventName)}</code></td>
        <td><pre>${escapeHtml(formatExpected(m.expected))}</pre></td>
        <td><pre>${escapeHtml(formatActual(m.actual))}</pre></td>
        <td>
          <details>
            <summary>raw</summary>
            <pre>${escapeHtml(JSON.stringify(m.actual.raw, null, 2))}</pre>
          </details>
        </td>
      </tr>`,
    )
    .join("");

  const missingRows = result.verification.missing
    .map((m) => {
      const near = m.nearMiss
        ? `<pre>${escapeHtml(m.nearMiss.diff)}</pre>
           <details><summary>near-miss actual</summary>
           <pre>${escapeHtml(formatActual(m.nearMiss.actual))}</pre></details>`
        : "—";
      return `
      <tr class="missing">
        <td>missing</td>
        <td><code>${escapeHtml(m.expected.eventName)}</code></td>
        <td><pre>${escapeHtml(formatExpected(m.expected))}</pre></td>
        <td colspan="2">${near}</td>
      </tr>`;
    })
    .join("");

  const unexpectedRows = result.verification.unexpected
    .map(
      (u) => `
      <tr class="unexpected">
        <td>unexpected</td>
        <td><code>${escapeHtml(u.eventName)}</code></td>
        <td>—</td>
        <td><pre>${escapeHtml(formatActual(u))}</pre></td>
        <td>
          <details>
            <summary>raw</summary>
            <pre>${escapeHtml(JSON.stringify(u.raw, null, 2))}</pre>
          </details>
        </td>
      </tr>`,
    )
    .join("");

  const timeline = result.events
    .map(
      (e, i) => `
      <li>
        <strong>#${i + 1} ${escapeHtml(e.eventName)}</strong>
        <span class="platform">${escapeHtml(e.platform)}</span>
        <pre>${escapeHtml(formatActual(e))}</pre>
      </li>`,
    )
    .join("");

  const stepLogRows = (result.stepLog ?? [])
    .map(
      (s) => `
      <tr class="${s.status === "skipped" || s.status === "failed" ? s.status : ""}">
        <td>${s.index + 1}</td>
        <td><code>${escapeHtml(s.action)}</code></td>
        <td>${escapeHtml(s.status)}</td>
        <td><code>${escapeHtml(s.detail ?? "")}</code></td>
        <td>${escapeHtml(s.reason ?? "")}</td>
      </tr>`,
    )
    .join("");

  const warningItems = (result.captureWarnings ?? [])
    .map((w) => `<li><code>${escapeHtml(w)}</code></li>`)
    .join("");

  const diagnosisSection = diagnosis
    ? (() => {
        const primaryIdx =
          diagnosis.primaryFindingIndexes ??
          diagnosis.findings.map((_, i) => i);
        const guidance = diagnosis.guidance ?? [];
        const primaryItems = primaryIdx
          .map((i) => diagnosis.findings[i])
          .filter((f): f is NonNullable<typeof f> => !!f)
          .map(
            (finding) =>
              `<li><strong>${escapeHtml(diagnosisLabel(finding.code))}</strong> <pre>${escapeHtml(finding.message)}</pre></li>`,
          )
          .join("");
        const technicalItems = diagnosis.findings
          .map(
            (finding) =>
              `<li><code>${escapeHtml(finding.code)}</code> <pre>${escapeHtml(finding.message)}</pre></li>`,
          )
          .join("");
        const guidanceHtml =
          guidance.length > 0
            ? `<p><strong>What to try</strong></p><ul>${guidance.map((g) => `<li>${escapeHtml(g)}</li>`).join("")}</ul>`
            : "";
        const cascadeHtml = diagnosis.cascadeNote
          ? `<p>${escapeHtml(diagnosis.cascadeNote)}</p>`
          : "";
        return `<section>
    <h2>Diagnosis</h2>
    <p>${escapeHtml(diagnosis.summary.split("\n")[0] ?? "")}</p>
    ${guidanceHtml}
    <ul>${primaryItems}</ul>
    ${cascadeHtml}
    <details>
      <summary>Technical findings</summary>
      <ul>${technicalItems}</ul>
    </details>
  </section>`;
      })()
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Akela — ${escapeHtml(result.journeyName)}</title>
  <style>
    :root { font-family: "Segoe UI", system-ui, sans-serif; color: #1a1a1a; }
    body { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; background: #f6f7f9; }
    header { background: #fff; border: 1px solid #dde1e6; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; }
    h1 { margin: 0 0 0.5rem; font-size: 1.4rem; }
    .status { font-weight: 700; color: ${statusColor}; font-size: 1.1rem; }
    .meta { color: #555; font-size: 0.9rem; }
    section { background: #fff; border: 1px solid #dde1e6; padding: 1rem 1.25rem; margin-bottom: 1rem; }
    h2 { margin-top: 0; font-size: 1.1rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { border: 1px solid #e3e6ea; padding: 0.5rem; vertical-align: top; text-align: left; }
    th { background: #f0f2f5; }
    tr.missing { background: #fff0f0; }
    tr.unexpected { background: #fff8e6; }
    tr.skipped { background: #f5f5f5; color: #666; }
    tr.failed { background: #fff0f0; color: #8a1f1f; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 0.8rem; }
    .error { background: #fff0f0; border-color: #f0c0c0; color: #8a1f1f; }
    .platform { color: #666; font-size: 0.8rem; margin-left: 0.5rem; }
    ul.timeline { list-style: none; padding: 0; }
    ul.timeline li { border-bottom: 1px solid #eee; padding: 0.75rem 0; }
    img.failure { max-width: 100%; border: 1px solid #dde1e6; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(result.journeyName)}</h1>
    <div class="status">${status}</div>
    <div class="meta">
      runId: ${escapeHtml(runId)} · baseUrl: ${escapeHtml(result.baseUrl)} ·
      duration: ${result.durationMs}ms ·
      events captured: ${result.events.length} ·
      match: ${result.verification.options.match} ·
      ordered: ${result.verification.options.ordered} ·
      forbidExtra: ${result.verification.options.forbidExtra}
      ${(result.captureWarnings?.length ?? 0) > 0 ? ` · capture warnings: ${result.captureWarnings.length}` : ""}
    </div>
  </header>
  ${
    result.error
      ? `<section class="error"><h2>Run error</h2><pre>${escapeHtml(result.error)}</pre></section>`
      : ""
  }
  ${
    screenshotPath
      ? `<section><h2>Failure screenshot</h2><p><code>${escapeHtml(screenshotPath)}</code></p><img class="failure" src="failure.png" alt="Failure screenshot" /></section>`
      : ""
  }
  ${diagnosisSection}
  ${
    warningItems
      ? `<section><h2>Capture warnings</h2><ul>${warningItems}</ul></section>`
      : ""
  }
  ${
    stepLogRows
      ? `<section>
    <h2>Step log</h2>
    <table>
      <thead><tr><th>#</th><th>Action</th><th>Status</th><th>Detail</th><th>Reason</th></tr></thead>
      <tbody>${stepLogRows}</tbody>
    </table>
  </section>`
      : ""
  }
  <section>
    <h2>Expected vs actual</h2>
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Event</th>
          <th>Expected</th>
          <th>Actual</th>
          <th>Raw</th>
        </tr>
      </thead>
      <tbody>
        ${matchedRows}${missingRows}${unexpectedRows || ""}
      </tbody>
    </table>
  </section>
  <section>
    <h2>Captured event timeline</h2>
    <ul class="timeline">${timeline || "<li>No events captured</li>"}</ul>
  </section>
</body>
</html>`;
}

function buildMarkdown(
  result: RunResult,
  runId: string,
  screenshotPath?: string,
  diagnosis?: DiagnosisResult,
): string {
  const status = result.pass ? "PASS" : "FAIL";
  const lines = [
    `# ${result.journeyName} — ${status}`,
    "",
    `- runId: \`${runId}\``,
    `- baseUrl: ${result.baseUrl}`,
    `- duration: ${result.durationMs}ms`,
    `- events: ${result.events.length}`,
    `- matched: ${result.verification.matched.length}`,
    `- missing: ${result.verification.missing.length}`,
    `- unexpected: ${result.verification.unexpected.length}`,
    `- match: ${result.verification.options.match}`,
    `- ordered: ${result.verification.options.ordered}`,
    `- forbidExtra: ${result.verification.options.forbidExtra}`,
    "",
  ];
  if (result.error) {
    lines.push("## Error", "", "```", result.error, "```", "");
  }
  if (screenshotPath) {
    lines.push("## Failure screenshot", "", `- \`${screenshotPath}\``, "");
  }
  if (diagnosis) {
    const primaryIdx =
      diagnosis.primaryFindingIndexes ?? diagnosis.findings.map((_, i) => i);
    const guidance = diagnosis.guidance ?? [];
    lines.push("## Diagnosis", "", diagnosis.summary.split("\n")[0] ?? "", "");
    if (guidance.length) {
      lines.push("### What to try", "");
      for (const g of guidance) lines.push(`- ${g}`);
      lines.push("");
    }
    for (const idx of primaryIdx) {
      const finding = diagnosis.findings[idx];
      if (!finding) continue;
      lines.push(`- **${diagnosisLabel(finding.code)}** —`);
      if (finding.message.includes("\n")) {
        lines.push("  ```", finding.message, "  ```");
      } else {
        lines.push(`  ${finding.message}`);
      }
    }
    if (diagnosis.cascadeNote) {
      lines.push("", diagnosis.cascadeNote, "");
    } else {
      lines.push("");
    }
    lines.push("### Technical findings", "");
    for (const finding of diagnosis.findings) {
      lines.push(`- \`${finding.code}\` —`);
      if (finding.message.includes("\n")) {
        lines.push("  ```", finding.message, "  ```");
      } else {
        lines.push(`  ${finding.message}`);
      }
    }
    lines.push("");
  }
  if (result.captureWarnings?.length) {
    lines.push("## Capture warnings", "");
    for (const w of result.captureWarnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }
  if (result.stepLog?.length) {
    lines.push("## Step log", "");
    for (const s of result.stepLog) {
      const reason = s.reason ? ` — ${s.reason}` : "";
      lines.push(
        `- ${s.index + 1}. \`${s.action}\` ${s.detail ?? ""} → **${s.status}**${reason}`,
      );
    }
    lines.push("");
  }
  if (result.verification.missing.length) {
    lines.push("## Missing", "");
    for (const m of result.verification.missing) {
      lines.push(`- \`${m.expected.eventName}\` ${formatExpected(m.expected)}`);
      if (m.nearMiss) {
        lines.push("  near-miss:", "```", m.nearMiss.diff, "```");
      }
    }
    lines.push("");
  }
  if (result.verification.unexpected.length) {
    lines.push("## Unexpected", "");
    for (const u of result.verification.unexpected) {
      lines.push(`- \`${u.eventName}\` ${formatActual(u)}`);
    }
    lines.push("");
  }
  if (result.verification.matched.length) {
    lines.push("## Matched", "");
    for (const m of result.verification.matched) {
      lines.push(`- \`${m.expected.eventName}\``);
      const diff = propDiff(m.expected, m.actual);
      if (diff) lines.push("```", diff, "```");
    }
    lines.push("");
  }
  return lines.join("\n");
}

export type ReportPaths = {
  runId: string;
  dir: string;
  html: string;
  json: string;
  markdown: string;
  screenshot?: string;
};

export function writeReports(result: RunResult, reportDir: string): ReportPaths {
  const runId = `${result.journeyName.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}`;
  const dir = join(reportDir, runId);
  mkdirSync(dir, { recursive: true });
  const diagnosis = result.pass ? undefined : diagnoseFailure(result);

  const htmlPath = join(dir, "report.html");
  const jsonPath = join(dir, "report.json");
  const mdPath = join(dir, "report.md");

  let screenshotPath: string | undefined;
  if (result.artifacts?.screenshot) {
    screenshotPath = join(dir, "failure.png");
    writeFileSync(screenshotPath, result.artifacts.screenshot);
  }

  writeFileSync(
    htmlPath,
    buildHtml(result, runId, screenshotPath, diagnosis),
    "utf8",
  );

  const { artifacts: _artifacts, ...rest } = result;
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        runId,
        ...rest,
        ...(screenshotPath ? { artifacts: { screenshotPath } } : {}),
        ...(diagnosis ? { diagnosis } : {}),
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    mdPath,
    buildMarkdown(result, runId, screenshotPath, diagnosis),
    "utf8",
  );

  return {
    runId,
    dir,
    html: htmlPath,
    json: jsonPath,
    markdown: mdPath,
    ...(screenshotPath ? { screenshot: screenshotPath } : {}),
  };
}
