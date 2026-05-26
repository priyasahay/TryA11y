// --------------------------------------------------------------------------
// @trya11y/core — axe-core scanner wrapper
// --------------------------------------------------------------------------

import axe from 'axe-core';
import type { A11yIssue, ScanResult, WcagLevel, Impact } from './types.js';

/**
 * Options accepted by {@link scan}.
 */
export interface ScanOptions {
  /** CSS selector or element to scope the scan to (defaults to `document`). */
  context?: string | HTMLElement;
  /** Explicit list of axe rule ids to enable. */
  rules?: string[];
  /** Only run rules that map to this WCAG conformance level or below. */
  wcagLevel?: WcagLevel;
}

/**
 * Run an axe-core accessibility scan and return normalised results.
 *
 * @param options - Optional scan scope and rule filters.
 * @returns A normalised scan summary with issues, counts, and duration.
 */
export async function scan(options: ScanOptions = {}): Promise<ScanResult> {
  const startTime = performance.now();

  const axeConfig: axe.RunOptions = {
    resultTypes: ['violations', 'passes', 'incomplete'],
    preload: false,
  };

  // Scope to specific rules when requested.
  if (options.rules?.length) {
    axeConfig.rules = Object.fromEntries(
      options.rules.map((r) => [r, { enabled: true }]),
    );
  }

  // Scope to a WCAG level when requested.
  if (options.wcagLevel) {
    const tagMap: Record<WcagLevel, string[]> = {
      A: ['wcag2a', 'wcag21a'],
      AA: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      AAA: [
        'wcag2a',
        'wcag2aa',
        'wcag2aaa',
        'wcag21a',
        'wcag21aa',
        'wcag21aaa',
        'wcag22aa',
      ],
    };
    axeConfig.runOnly = { type: 'tag', values: tagMap[options.wcagLevel] };
  }

  const axeContext: axe.ElementContext = options.context
    ? (options.context as axe.ElementContext)
    : { exclude: [['[data-trya11y-focus-overlay]'], ['.trya11y-highlight']] };

  axe.reset();
  const results = await axe.run(axeContext, axeConfig);

  const issues: A11yIssue[] = results.violations.flatMap((violation) =>
    violation.nodes.map((node, idx) => normalizeIssue(violation, node, idx)),
  );

  return {
    url: window.location.href,
    timestamp: Date.now(),
    issues,
    passes: results.passes.length,
    violations: issues.length,
    incomplete: results.incomplete.length,
    scanDurationMs: Math.round(performance.now() - startTime),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map an axe violation + node pair into our normalised {@link A11yIssue}.
 */
function normalizeIssue(
  violation: axe.Result,
  node: axe.NodeResult,
  index: number,
): A11yIssue {
  const wcagTags = violation.tags.filter((t) => t.startsWith('wcag'));
  const wcagLevel = extractWcagLevel(violation.tags);

  return {
    id: `${violation.id}-${index}`,
    ruleId: violation.id,
    description: violation.description,
    help: violation.help,
    helpUrl: violation.helpUrl,
    impact: (violation.impact ?? 'moderate') as Impact,
    wcagTags,
    wcagLevel,
    element: {
      selector: node.target.join(' > '),
      html: node.html,
      tagName: extractTagName(node.html),
    },
  };
}

/**
 * Derive the highest WCAG conformance level from a set of axe tags.
 */
function extractWcagLevel(tags: string[]): WcagLevel {
  if (tags.some((t) => t.includes('aaa'))) return 'AAA';
  if (tags.some((t) => t.includes('aa'))) return 'AA';
  return 'A';
}

/**
 * Pull the tag name out of an HTML snippet.
 */
function extractTagName(html: string): string {
  const match = html.match(/^<(\w+)/);
  return match ? match[1].toLowerCase() : 'unknown';
}
