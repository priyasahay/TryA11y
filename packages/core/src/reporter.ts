// --------------------------------------------------------------------------
// @trya11y/core — Report generator
//
// Produces self-contained HTML, structured JSON, or Markdown reports
// from a scan result.
// --------------------------------------------------------------------------

import type {
  ScanResult,
  ReportOptions,
  A11yIssue,
  FixSuggestion,
  Impact,
} from './types.js';

/**
 * Generate a report string from a scan result.
 *
 * @param result - The accessibility scan output to render.
 * @param options - The desired report format and presentation options.
 * @returns A serialized HTML, JSON, or Markdown report.
 *
 * @example
 * ```ts
 * const report = generateReport(scanResult, { format: 'markdown', title: 'Homepage audit' });
 * ```
 */
export function generateReport(
  result: ScanResult,
  options: ReportOptions,
): string {
  switch (options.format) {
    case 'html':
      return generateHtmlReport(result, options);
    case 'json':
      return generateJsonReport(result, options);
    case 'markdown':
      return generateMarkdownReport(result, options);
    default:
      throw new Error(`Unsupported report format: ${options.format}`);
  }
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Impact[] = ['critical', 'serious', 'moderate', 'minor'];

const SEVERITY_COLORS: Record<Impact, string> = {
  critical: '#d32f2f',
  serious: '#f57c00',
  moderate: '#fbc02d',
  minor: '#1976d2',
};

const SEVERITY_BG: Record<Impact, string> = {
  critical: '#fde8e8',
  serious: '#fff3e0',
  moderate: '#fffde7',
  minor: '#e3f2fd',
};

function countBySeverity(issues: A11yIssue[]): Record<Impact, number> {
  const counts: Record<Impact, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };
  for (const issue of issues) {
    counts[issue.impact] = (counts[issue.impact] ?? 0) + 1;
  }
  return counts;
}

function issuesWithFixes(issues: A11yIssue[]): number {
  return issues.filter((i) => i.fix).length;
}

// ---------------------------------------------------------------------------
// HTML Report
// ---------------------------------------------------------------------------

function generateHtmlReport(result: ScanResult, options: ReportOptions): string {
  const title = options.title ?? `Accessibility Report — ${result.url}`;
  const counts = countBySeverity(result.issues);
  const fixCount = issuesWithFixes(result.issues);
  const scanDate = new Date(result.timestamp).toLocaleString();

  const issueCards = result.issues
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.impact) - SEVERITY_ORDER.indexOf(b.impact))
    .map((issue) => renderIssueCard(issue, options))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a1a;
    background: #f5f5f5;
    line-height: 1.6;
  }
  .container { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
  header {
    background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
    color: #fff;
    padding: 32px 0;
    margin-bottom: 24px;
  }
  header .container { padding-top: 0; padding-bottom: 0; }
  header h1 { margin: 0 0 4px; font-size: 24px; font-weight: 700; }
  header p { margin: 0; opacity: 0.85; font-size: 14px; }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  .stat-card {
    background: #fff;
    border-radius: 8px;
    padding: 16px;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .stat-card .value { font-size: 28px; font-weight: 700; }
  .stat-card .label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
  .severity-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .severity-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 13px;
    font-weight: 600;
  }
  .severity-chip .dot {
    width: 8px; height: 8px; border-radius: 50%;
  }
  .issue-card {
    background: #fff;
    border-radius: 8px;
    margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    overflow: hidden;
  }
  .issue-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    cursor: pointer;
    user-select: none;
  }
  .issue-header:hover { background: #fafafa; }
  .issue-badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #fff;
    flex-shrink: 0;
  }
  .issue-title { flex: 1; font-weight: 600; font-size: 14px; }
  .issue-rule { font-size: 12px; color: #888; font-family: monospace; }
  .issue-body { padding: 0 16px 16px; display: none; }
  .issue-card.open .issue-body { display: block; }
  .issue-card.open .toggle-icon { transform: rotate(90deg); }
  .toggle-icon { transition: transform 0.15s; font-size: 12px; color: #999; }
  .detail-row { margin-bottom: 10px; }
  .detail-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #888; margin-bottom: 2px; }
  .detail-value { font-size: 13px; }
  pre.code-block {
    background: #f8f8f8;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 10px 12px;
    font-size: 12px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .fix-box {
    background: #e8f5e9;
    border-left: 3px solid #43a047;
    border-radius: 0 4px 4px 0;
    padding: 10px 12px;
    margin-top: 8px;
  }
  .fix-box .fix-title { font-weight: 700; font-size: 12px; color: #2e7d32; margin-bottom: 4px; }
  .confidence-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .confidence-high { background: #c8e6c9; color: #2e7d32; }
  .confidence-medium { background: #fff9c4; color: #f57f17; }
  .confidence-low { background: #ffcdd2; color: #c62828; }
  .wcag-tags { display: flex; gap: 4px; flex-wrap: wrap; }
  .wcag-tag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    background: #e8eaf6;
    color: #3949ab;
    font-family: monospace;
  }
  footer {
    text-align: center;
    color: #999;
    font-size: 12px;
    padding: 24px 0;
    border-top: 1px solid #e0e0e0;
    margin-top: 24px;
  }
  @media (max-width: 600px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
<header>
  <div class="container">
    <h1>${escHtml(title)}</h1>
    <p>${escHtml(result.url)} &mdash; scanned ${escHtml(scanDate)} &mdash; ${result.scanDurationMs}ms</p>
  </div>
</header>

<div class="container">
  <div class="stats">
    <div class="stat-card">
      <div class="value" style="color:${SEVERITY_COLORS.critical}">${result.violations}</div>
      <div class="label">Violations</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:#43a047">${result.passes}</div>
      <div class="label">Passing Rules</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:#7b1fa2">${fixCount}</div>
      <div class="label">Auto-fixes</div>
    </div>
    <div class="stat-card">
      <div class="value">${result.incomplete}</div>
      <div class="label">Needs Review</div>
    </div>
  </div>

  <div class="severity-bar">
    ${SEVERITY_ORDER.map(
      (s) =>
        `<span class="severity-chip" style="background:${SEVERITY_BG[s]}; color:${SEVERITY_COLORS[s]}">` +
        `<span class="dot" style="background:${SEVERITY_COLORS[s]}"></span>${s}: ${counts[s]}</span>`,
    ).join('\n    ')}
  </div>

  ${issueCards}
</div>

<footer>
  Generated by <strong>TryA11y</strong> &mdash; heuristic accessibility fix engine
</footer>

<script>
  document.querySelectorAll('.issue-header').forEach(function(header) {
    header.addEventListener('click', function() {
      header.closest('.issue-card').classList.toggle('open');
    });
  });
</script>
</body>
</html>`;
}

function renderIssueCard(issue: A11yIssue, options: ReportOptions): string {
  const color = SEVERITY_COLORS[issue.impact];
  const fixHtml =
    options.includeFixes && issue.fix ? renderFixBox(issue.fix) : '';

  return `<div class="issue-card">
  <div class="issue-header">
    <span class="toggle-icon">&#9654;</span>
    <span class="issue-badge" style="background:${color}">${issue.impact}</span>
    <span class="issue-title">${escHtml(issue.help)}</span>
    <span class="issue-rule">${escHtml(issue.ruleId)}</span>
  </div>
  <div class="issue-body">
    <div class="detail-row">
      <div class="detail-label">Description</div>
      <div class="detail-value">${escHtml(issue.description)}</div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Element</div>
      <pre class="code-block">${escHtml(issue.element.html)}</pre>
    </div>
    <div class="detail-row">
      <div class="detail-label">Selector</div>
      <div class="detail-value"><code>${escHtml(issue.element.selector)}</code></div>
    </div>
    <div class="detail-row">
      <div class="detail-label">WCAG</div>
      <div class="wcag-tags">
        ${issue.wcagTags.map((t) => `<span class="wcag-tag">${escHtml(t)}</span>`).join(' ')}
        <span class="wcag-tag">Level ${issue.wcagLevel}</span>
      </div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Learn more</div>
      <div class="detail-value"><a href="${escHtml(issue.helpUrl)}" target="_blank" rel="noopener">${escHtml(issue.helpUrl)}</a></div>
    </div>
    ${fixHtml}
  </div>
</div>`;
}

function renderFixBox(fix: FixSuggestion): string {
  const confClass =
    fix.confidence === 'high'
      ? 'confidence-high'
      : fix.confidence === 'medium'
        ? 'confidence-medium'
        : 'confidence-low';

  return `<div class="fix-box">
  <div class="fix-title">Suggested Fix <span class="confidence-badge ${confClass}">${fix.confidence}</span></div>
  <div class="detail-value" style="margin-bottom:8px">${escHtml(fix.description)}</div>
  <div class="detail-label">Before</div>
  <pre class="code-block">${escHtml(fix.oldHtml)}</pre>
  <div class="detail-label" style="margin-top:8px">After</div>
  <pre class="code-block">${escHtml(fix.newHtml)}</pre>
</div>`;
}

// ---------------------------------------------------------------------------
// JSON Report
// ---------------------------------------------------------------------------

function generateJsonReport(result: ScanResult, options: ReportOptions): string {
  const data: Record<string, unknown> = {
    meta: {
      generatedAt: new Date().toISOString(),
      generator: 'TryA11y',
      title: options.title ?? 'Accessibility Report',
    },
    scan: {
      url: result.url,
      timestamp: result.timestamp,
      durationMs: result.scanDurationMs,
    },
    summary: {
      violations: result.violations,
      passes: result.passes,
      incomplete: result.incomplete,
      fixesGenerated: issuesWithFixes(result.issues),
      bySeverity: countBySeverity(result.issues),
    },
    issues: result.issues.map((issue) => {
      const entry: Record<string, unknown> = {
        id: issue.id,
        ruleId: issue.ruleId,
        impact: issue.impact,
        wcagLevel: issue.wcagLevel,
        wcagTags: issue.wcagTags,
        description: issue.description,
        help: issue.help,
        helpUrl: issue.helpUrl,
        element: issue.element,
      };
      if (options.includeFixes && issue.fix) {
        entry.fix = issue.fix;
      }
      return entry;
    }),
  };

  return JSON.stringify(data, null, 2);
}

// ---------------------------------------------------------------------------
// Markdown Report
// ---------------------------------------------------------------------------

function generateMarkdownReport(result: ScanResult, options: ReportOptions): string {
  const title = options.title ?? 'Accessibility Report';
  const counts = countBySeverity(result.issues);
  const fixCount = issuesWithFixes(result.issues);
  const scanDate = new Date(result.timestamp).toISOString();

  const sections: string[] = [];

  // Title
  sections.push(`# ${title}\n`);

  // Summary
  sections.push(`## Summary\n`);
  sections.push(`| Metric | Value |`);
  sections.push(`|--------|-------|`);
  sections.push(`| **URL** | ${result.url} |`);
  sections.push(`| **Scanned** | ${scanDate} |`);
  sections.push(`| **Duration** | ${result.scanDurationMs}ms |`);
  sections.push(`| **Violations** | ${result.violations} |`);
  sections.push(`| **Passing rules** | ${result.passes} |`);
  sections.push(`| **Needs review** | ${result.incomplete} |`);
  sections.push(`| **Auto-fixes generated** | ${fixCount} |`);
  sections.push('');

  // Severity breakdown
  sections.push(`## Violations by Severity\n`);
  sections.push(`| Severity | Count |`);
  sections.push(`|----------|-------|`);
  for (const sev of SEVERITY_ORDER) {
    const emoji = sev === 'critical' ? '🔴' : sev === 'serious' ? '🟠' : sev === 'moderate' ? '🟡' : '🔵';
    sections.push(`| ${emoji} ${sev} | ${counts[sev]} |`);
  }
  sections.push('');

  // Issues
  sections.push(`## Issues\n`);

  const sorted = [...result.issues].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.impact) - SEVERITY_ORDER.indexOf(b.impact),
  );

  for (const issue of sorted) {
    sections.push(`### ${issue.impact.toUpperCase()}: ${issue.help}\n`);
    sections.push(`- **Rule:** \`${issue.ruleId}\``);
    sections.push(`- **Impact:** ${issue.impact}`);
    sections.push(`- **WCAG:** ${issue.wcagTags.join(', ') || `Level ${issue.wcagLevel}`}`);
    sections.push(`- **Element:** \`${issue.element.selector}\``);
    sections.push(`- **Help:** [${issue.help}](${issue.helpUrl})`);
    sections.push('');
    sections.push('```html');
    sections.push(issue.element.html);
    sections.push('```\n');

    if (options.includeFixes && issue.fix) {
      const fix = issue.fix;
      sections.push(`> **Suggested fix** (${fix.confidence} confidence): ${fix.description}\n`);
      sections.push('Before:');
      sections.push('```html');
      sections.push(fix.oldHtml);
      sections.push('```');
      sections.push('After:');
      sections.push('```html');
      sections.push(fix.newHtml);
      sections.push('```\n');
    }
  }

  // Footer
  sections.push('---');
  sections.push('');
  sections.push('*Generated by **TryA11y** — heuristic accessibility fix engine.*');

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
