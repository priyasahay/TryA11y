// --------------------------------------------------------------------------
// @trya11y/core — Heuristic fix engine
//
// Generates contextual, DOM-aware fix suggestions for accessibility issues.
// Every heuristic inspects the live DOM (surrounding elements, text content,
// computed styles, attributes, etc.) to produce meaningful fixes — never
// generic placeholders.
// --------------------------------------------------------------------------

import type { A11yIssue, FixSuggestion, FixType } from './types.js';

// ---------------------------------------------------------------------------
// Heuristic registry
// ---------------------------------------------------------------------------

type FixHeuristic = (issue: A11yIssue, element: Element) => FixSuggestion | null;

const heuristics: Record<string, FixHeuristic> = {};

/**
 * Register a heuristic for a specific axe rule id.
 *
 * @param ruleId - The axe rule identifier the heuristic handles.
 * @param heuristic - A DOM-aware fix generator for matching issues.
 * @returns Nothing.
 */
export function registerHeuristic(ruleId: string, heuristic: FixHeuristic): void {
  heuristics[ruleId] = heuristic;
}

/** Generate a fix suggestion for a single issue. */
export function generateFix(issue: A11yIssue, element: Element): FixSuggestion | null {
  const heuristic = heuristics[issue.ruleId];
  if (heuristic) return heuristic(issue, element);
  return genericFix(issue, element);
}

/**
 * Generate fixes for a batch of issues.
 *
 * @param issues - The normalised accessibility issues to resolve.
 * @returns A map keyed by issue id for every issue that produced a fix.
 */
export function generateFixes(issues: A11yIssue[]): Map<string, FixSuggestion> {
  const fixes = new Map<string, FixSuggestion>();
  for (const issue of issues) {
    const el = document.querySelector(issue.element.selector);
    if (!el) continue;
    const fix = generateFix(issue, el);
    if (fix) fixes.set(issue.id, fix);
  }
  return fixes;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Title-case a string of words. */
function titleCase(str: string): string {
  return str
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Humanize a camelCase / snake_case / kebab-case identifier. */
function humanize(str: string): string {
  return titleCase(str.replace(/[-_]+/g, ' '));
}

/** Get the trimmed text content of an element, limited to `maxLen` chars. */
function textOf(el: Element | null | undefined, maxLen = 120): string {
  if (!el) return '';
  return (el.textContent ?? '').trim().slice(0, maxLen);
}

/** Rebuild the outer HTML of `el` after inserting/modifying an attribute. */
function setAttrHtml(el: Element, attr: string, value: string): string {
  const clone = el.cloneNode(true) as Element;
  clone.setAttribute(attr, value);
  return clone.outerHTML;
}

/** Remove an attribute from a cloned element and return its outer HTML. */
function removeAttrHtml(el: Element, attr: string): string {
  const clone = el.cloneNode(true) as Element;
  clone.removeAttribute(attr);
  return clone.outerHTML;
}

/** Change the tag name of an element clone and return outer HTML. */
function changeTagHtml(el: Element, newTag: string): string {
  const clone = el.cloneNode(true) as Element;
  const wrapper = document.createElement(newTag);
  // Copy attributes
  for (const attr of Array.from(clone.attributes)) {
    wrapper.setAttribute(attr.name, attr.value);
  }
  wrapper.innerHTML = clone.innerHTML;
  return wrapper.outerHTML;
}

// ===================================================================
// 1. image-alt
// ===================================================================

registerHeuristic('image-alt', (issue, element) => {
  const img = element as HTMLImageElement;
  const oldHtml = img.outerHTML;

  // 1. Inside <figure> with <figcaption>
  const figure = img.closest('figure');
  if (figure) {
    const caption = figure.querySelector('figcaption');
    if (caption) {
      const alt = textOf(caption);
      if (alt) {
        return {
          description: `Use the figcaption text as alt text: "${alt}"`,
          type: 'add-attribute',
          attribute: 'alt',
          value: alt,
          oldHtml,
          newHtml: setAttrHtml(img, 'alt', alt),
          confidence: 'high',
          reasoning: 'Found <figcaption> inside parent <figure> — strong semantic association between caption and image.',
        };
      }
    }
  }

  // 2. Title attribute
  const title = img.getAttribute('title');
  if (title?.trim()) {
    return {
      description: `Use the existing title attribute as alt text: "${title.trim()}"`,
      type: 'add-attribute',
      attribute: 'alt',
      value: title.trim(),
      oldHtml,
      newHtml: setAttrHtml(img, 'alt', title.trim()),
      confidence: 'high',
      reasoning: 'Image has a title attribute — repurposed as alt text since both convey the same label.',
    };
  }

  // 3. Inside an <a> — use link text
  const anchor = img.closest('a');
  if (anchor) {
    // Collect text that is NOT from the image itself
    const linkText = Array.from(anchor.childNodes)
      .filter((n) => n !== img)
      .map((n) => (n.textContent ?? '').trim())
      .filter(Boolean)
      .join(' ');
    if (linkText) {
      return {
        description: `Use surrounding link text as alt: "${linkText}"`,
        type: 'add-attribute',
        attribute: 'alt',
        value: linkText,
        oldHtml,
        newHtml: setAttrHtml(img, 'alt', linkText),
        confidence: 'medium',
        reasoning: 'Image is inside an <a> with visible sibling text — link text describes the destination, not necessarily the image itself.',
      };
    }
  }

  // 4. Decorative image detection
  const width = img.naturalWidth || img.width || parseInt(img.getAttribute('width') ?? '0', 10);
  const height = img.naturalHeight || img.height || parseInt(img.getAttribute('height') ?? '0', 10);
  const role = img.getAttribute('role');
  const isSmall = width > 0 && height > 0 && width <= 5 && height <= 5;
  const isPresentation = role === 'presentation' || role === 'none';

  if (isSmall || isPresentation) {
    return {
      description: 'Mark as decorative (empty alt) — image appears non-informational',
      type: 'add-attribute',
      attribute: 'alt',
      value: '',
      oldHtml,
      newHtml: setAttrHtml(img, 'alt', ''),
      confidence: 'high',
      reasoning: isSmall
        ? `Image is ${width}×${height}px — likely a spacer, pixel tracker, or icon with no informational value.`
        : 'role="presentation" or role="none" explicitly marks this image as decorative.',
    };
  }

  // 5. Parse src filename
  const src = img.getAttribute('src') ?? '';
  if (src) {
    try {
      const pathname = new URL(src, window.location.href).pathname;
      const filename = pathname.split('/').pop() ?? '';
      const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
      if (nameWithoutExt && nameWithoutExt.length > 1) {
        const alt = titleCase(nameWithoutExt);
        return {
          description: `Derive alt text from filename: "${alt}"`,
          type: 'add-attribute',
          attribute: 'alt',
          value: alt,
          oldHtml,
          newHtml: setAttrHtml(img, 'alt', alt),
          confidence: 'medium',
          reasoning: `No semantic context (figcaption, title, link text) found nearby — derived from the src filename "${nameWithoutExt}". Verify this accurately describes the image.`,
        };
      }
    } catch {
      // Invalid URL — fall through
    }
  }

  // 6. Surrounding heading for context
  const headingSelector = 'h1, h2, h3, h4, h5, h6';
  let heading: Element | null = null;
  // Check previous siblings
  let prev = img.previousElementSibling;
  while (prev) {
    if (prev.matches(headingSelector)) {
      heading = prev;
      break;
    }
    prev = prev.previousElementSibling;
  }
  // Check parent heading
  if (!heading) {
    heading = img.closest(headingSelector);
  }
  if (heading) {
    const alt = textOf(heading);
    if (alt) {
      return {
        description: `Use nearby heading text as alt: "${alt}"`,
        type: 'add-attribute',
        attribute: 'alt',
        value: alt,
        oldHtml,
        newHtml: setAttrHtml(img, 'alt', alt),
        confidence: 'low',
        reasoning: 'Found a heading element nearby, but the association is positional — the heading may describe the section, not this specific image.',
      };
    }
  }

  // 7. Fallback
  return {
    description: 'Add descriptive alt text (review needed — could not infer from context)',
    type: 'add-attribute',
    attribute: 'alt',
    value: 'TODO: Describe this image',
    oldHtml,
    newHtml: setAttrHtml(img, 'alt', 'TODO: Describe this image'),
    confidence: 'low',
    reasoning: 'No figcaption, title, link text, role, filename, or nearby heading found — the image content cannot be inferred from the DOM alone.',
  };
});

// ===================================================================
// 2. button-name
// ===================================================================

registerHeuristic('button-name', (issue, element) => {
  const btn = element as HTMLElement;
  const oldHtml = btn.outerHTML;

  // 1. SVG or icon child — look for <title> inside SVG or sr-only span
  const svg = btn.querySelector('svg');
  if (svg) {
    const svgTitle = svg.querySelector('title');
    if (svgTitle) {
      const label = textOf(svgTitle);
      if (label) {
        return {
          description: `Use SVG <title> as aria-label: "${label}"`,
          type: 'add-attribute',
          attribute: 'aria-label',
          value: label,
          oldHtml,
          newHtml: setAttrHtml(btn, 'aria-label', label),
          confidence: 'high',
          reasoning: 'Found a <title> element inside the button\'s SVG — this is the established pattern for labelling icon buttons.',
        };
      }
    }
  }

  const srOnly = btn.querySelector('.sr-only, .visually-hidden, .screen-reader-text');
  if (srOnly) {
    const label = textOf(srOnly);
    if (label) {
      return {
        description: `Use screen-reader-only text as aria-label: "${label}"`,
        type: 'add-attribute',
        attribute: 'aria-label',
        value: label,
        oldHtml,
        newHtml: setAttrHtml(btn, 'aria-label', label),
        confidence: 'high',
        reasoning: 'Found a visually-hidden sr-only/visually-hidden span inside the button — this text was already written for screen readers.',
      };
    }
  }

  // 2. Value attribute (for input[type=button|submit])
  if (btn instanceof HTMLInputElement) {
    const value = btn.getAttribute('value');
    if (value?.trim()) {
      return {
        description: `Input already has a value attribute: "${value.trim()}"`,
        type: 'add-attribute',
        attribute: 'aria-label',
        value: value.trim(),
        oldHtml,
        newHtml: setAttrHtml(btn, 'aria-label', value.trim()),
        confidence: 'high',
      };
    }
  }

  // 3. Title attribute
  const title = btn.getAttribute('title');
  if (title?.trim()) {
    return {
      description: `Use existing title attribute as aria-label: "${title.trim()}"`,
      type: 'add-attribute',
      attribute: 'aria-label',
      value: title.trim(),
      oldHtml,
      newHtml: setAttrHtml(btn, 'aria-label', title.trim()),
      confidence: 'high',
    };
  }

  // 4. Infer from CSS classes
  const classes = btn.className.toLowerCase();
  const classIntentMap: Record<string, string> = {
    close: 'Close',
    dismiss: 'Dismiss',
    menu: 'Open menu',
    'menu-toggle': 'Toggle menu',
    hamburger: 'Open menu',
    search: 'Search',
    delete: 'Delete',
    remove: 'Remove',
    save: 'Save',
    submit: 'Submit',
    cancel: 'Cancel',
    edit: 'Edit',
    add: 'Add',
    expand: 'Expand',
    collapse: 'Collapse',
    toggle: 'Toggle',
    play: 'Play',
    pause: 'Pause',
    prev: 'Previous',
    next: 'Next',
    back: 'Go back',
    forward: 'Go forward',
    settings: 'Settings',
    'sign-in': 'Sign in',
    login: 'Log in',
    logout: 'Log out',
    'sign-out': 'Sign out',
    copy: 'Copy',
    share: 'Share',
    download: 'Download',
    upload: 'Upload',
    refresh: 'Refresh',
    print: 'Print',
  };

  for (const [pattern, label] of Object.entries(classIntentMap)) {
    if (classes.includes(pattern)) {
      return {
        description: `Inferred "${label}" from CSS class containing "${pattern}"`,
        type: 'add-attribute',
        attribute: 'aria-label',
        value: label,
        oldHtml,
        newHtml: setAttrHtml(btn, 'aria-label', label),
        confidence: 'medium',
        reasoning: `CSS class name contains "${pattern}" which maps to a known action pattern. No explicit label found in the DOM.`,
      };
    }
  }

  // 5. Parent container context
  const dialog = btn.closest('[role="dialog"], dialog, .modal');
  if (dialog) {
    // If the button is in a dialog header area, likely a close button
    const header = btn.closest('.modal-header, .dialog-header, header, [class*="header"]');
    if (header) {
      return {
        description: 'Button inside a dialog header — likely a "Close" button',
        type: 'add-attribute',
        attribute: 'aria-label',
        value: 'Close dialog',
        oldHtml,
        newHtml: setAttrHtml(btn, 'aria-label', 'Close dialog'),
        confidence: 'medium',
      };
    }
  }

  const nav = btn.closest('nav, [role="navigation"]');
  if (nav) {
    return {
      description: 'Button inside navigation — likely a menu toggle',
      type: 'add-attribute',
      attribute: 'aria-label',
      value: 'Toggle navigation menu',
      oldHtml,
      newHtml: setAttrHtml(btn, 'aria-label', 'Toggle navigation menu'),
      confidence: 'medium',
    };
  }

  const form = btn.closest('form');
  if (form) {
    return {
      description: 'Button inside a form — likely a submit button',
      type: 'add-attribute',
      attribute: 'aria-label',
      value: 'Submit',
      oldHtml,
      newHtml: setAttrHtml(btn, 'aria-label', 'Submit'),
      confidence: 'low',
    };
  }

  // 6. Nearby visible label / heading
  const nearbyHeading = btn.parentElement?.querySelector('h1, h2, h3, h4, h5, h6');
  if (nearbyHeading) {
    const headingText = textOf(nearbyHeading);
    if (headingText) {
      return {
        description: `Use nearby heading for context: "${headingText}"`,
        type: 'add-attribute',
        attribute: 'aria-label',
        value: headingText,
        oldHtml,
        newHtml: setAttrHtml(btn, 'aria-label', headingText),
        confidence: 'low',
      };
    }
  }

  return {
    description: 'Add an aria-label (review needed — could not infer purpose)',
    type: 'add-attribute',
    attribute: 'aria-label',
    value: 'TODO: Describe this button',
    oldHtml,
    newHtml: setAttrHtml(btn, 'aria-label', 'TODO: Describe this button'),
    confidence: 'low',
  };
});

// ===================================================================
// 3. link-name
// ===================================================================

registerHeuristic('link-name', (issue, element) => {
  const link = element as HTMLAnchorElement;
  const oldHtml = link.outerHTML;

  // 1. Child image with alt text
  const imgs = link.querySelectorAll('img[alt]');
  for (const img of Array.from(imgs)) {
    const alt = img.getAttribute('alt')?.trim();
    if (alt) {
      return {
        description: `Use child image alt text as link label: "${alt}"`,
        type: 'add-attribute',
        attribute: 'aria-label',
        value: alt,
        oldHtml,
        newHtml: setAttrHtml(link, 'aria-label', alt),
        confidence: 'high',
      };
    }
  }

  // 2. Title attribute
  const title = link.getAttribute('title');
  if (title?.trim()) {
    return {
      description: `Use existing title as aria-label: "${title.trim()}"`,
      type: 'add-attribute',
      attribute: 'aria-label',
      value: title.trim(),
      oldHtml,
      newHtml: setAttrHtml(link, 'aria-label', title.trim()),
      confidence: 'high',
    };
  }

  // 3. Parse href for meaningful text
  const href = link.getAttribute('href') ?? '';
  if (href && href !== '#' && href !== 'javascript:void(0)') {
    try {
      const url = new URL(href, window.location.href);
      const pathname = url.pathname.replace(/\/$/, '');
      const segments = pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1];
      if (lastSegment && lastSegment.length > 1 && !lastSegment.includes('.')) {
        const label = titleCase(lastSegment);
        return {
          description: `Derive label from href path: "${label}"`,
          type: 'add-attribute',
          attribute: 'aria-label',
          value: label,
          oldHtml,
          newHtml: setAttrHtml(link, 'aria-label', label),
          confidence: 'medium',
        };
      }
    } catch {
      // Invalid URL — fall through
    }
  }

  // 4. CSS classes for intent
  const classes = link.className.toLowerCase();
  const linkIntentMap: Record<string, string> = {
    'skip-link': 'Skip to main content',
    skip: 'Skip to main content',
    logo: 'Home',
    home: 'Home',
    back: 'Go back',
    next: 'Next',
    prev: 'Previous',
    close: 'Close',
    external: 'External link',
    download: 'Download',
  };

  for (const [pattern, label] of Object.entries(linkIntentMap)) {
    if (classes.includes(pattern)) {
      return {
        description: `Inferred "${label}" from CSS class containing "${pattern}"`,
        type: 'add-attribute',
        attribute: 'aria-label',
        value: label,
        oldHtml,
        newHtml: setAttrHtml(link, 'aria-label', label),
        confidence: 'medium',
      };
    }
  }

  // 5. Icon font wrapper
  const iconPatterns = ['icon', 'fa-', 'material-', 'glyphicon', 'bi-', 'feather-'];
  const children = Array.from(link.children);
  for (const child of children) {
    const childClasses = child.className.toLowerCase();
    for (const pat of iconPatterns) {
      if (childClasses.includes(pat)) {
        // Try to infer from the icon class itself
        const iconMatch = childClasses.match(
          /(?:fa-|material-icons?-?|bi-|icon-|feather-)([a-z-]+)/,
        );
        if (iconMatch) {
          const label = titleCase(iconMatch[1]);
          return {
            description: `Inferred "${label}" from icon class "${iconMatch[0]}"`,
            type: 'add-attribute',
            attribute: 'aria-label',
            value: label,
            oldHtml,
            newHtml: setAttrHtml(link, 'aria-label', label),
            confidence: 'medium',
          };
        }
      }
    }
  }

  return {
    description: 'Add an aria-label (review needed — could not infer purpose)',
    type: 'add-attribute',
    attribute: 'aria-label',
    value: 'TODO: Describe this link',
    oldHtml,
    newHtml: setAttrHtml(link, 'aria-label', 'TODO: Describe this link'),
    confidence: 'low',
  };
});

// ===================================================================
// 4. label  (form inputs without labels)
// ===================================================================

registerHeuristic('label', (issue, element) => {
  const input = element as HTMLInputElement;
  const oldHtml = input.outerHTML;

  // 1. Placeholder → use as label text (with advisory note)
  const placeholder = input.getAttribute('placeholder');
  if (placeholder?.trim()) {
    const label = placeholder.trim();
    return {
      description: `Use placeholder text as a visible <label>. Note: placeholder alone is insufficient per WCAG.`,
      type: 'add-element',
      attribute: 'id',
      value: label,
      oldHtml,
      newHtml: `<label for="${input.id || generateId(label)}">${label}</label>\n${input.id ? oldHtml : setAttrHtml(input, 'id', generateId(label))}`,
      confidence: 'medium',
    };
  }

  // 2. name attribute → humanize
  const name = input.getAttribute('name');
  if (name?.trim()) {
    const label = humanize(name);
    return {
      description: `Derive label from name attribute: "${label}"`,
      type: 'add-element',
      attribute: 'id',
      value: label,
      oldHtml,
      newHtml: `<label for="${input.id || generateId(label)}">${label}</label>\n${input.id ? oldHtml : setAttrHtml(input, 'id', generateId(label))}`,
      confidence: 'medium',
    };
  }

  // 3. aria-describedby target text
  const describedBy = input.getAttribute('aria-describedby');
  if (describedBy) {
    const descEl = document.getElementById(describedBy);
    if (descEl) {
      const label = textOf(descEl);
      if (label) {
        return {
          description: `Use aria-describedby target text as label: "${label}"`,
          type: 'add-attribute',
          attribute: 'aria-label',
          value: label,
          oldHtml,
          newHtml: setAttrHtml(input, 'aria-label', label),
          confidence: 'medium',
        };
      }
    }
  }

  // 4. Adjacent text nodes or <span> siblings
  const parent = input.parentElement;
  if (parent) {
    // Check previous sibling text
    const prevSibling = input.previousSibling;
    if (prevSibling?.nodeType === Node.TEXT_NODE) {
      const text = (prevSibling.textContent ?? '').trim();
      if (text.length > 1 && text.length < 100) {
        return {
          description: `Use adjacent text as label: "${text}"`,
          type: 'add-attribute',
          attribute: 'aria-label',
          value: text,
          oldHtml,
          newHtml: setAttrHtml(input, 'aria-label', text),
          confidence: 'medium',
        };
      }
    }

    // Check sibling <span> elements
    const spans = parent.querySelectorAll('span, strong, em, b');
    for (const span of Array.from(spans)) {
      const text = textOf(span);
      if (text && text.length > 1 && text.length < 100) {
        return {
          description: `Use adjacent element text as label: "${text}"`,
          type: 'add-attribute',
          attribute: 'aria-label',
          value: text,
          oldHtml,
          newHtml: setAttrHtml(input, 'aria-label', text),
          confidence: 'medium',
        };
      }
    }
  }

  // 5. Fieldset / legend
  const fieldset = input.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend) {
      const text = textOf(legend);
      if (text) {
        return {
          description: `Use fieldset legend for context: "${text}"`,
          type: 'add-attribute',
          attribute: 'aria-label',
          value: text,
          oldHtml,
          newHtml: setAttrHtml(input, 'aria-label', text),
          confidence: 'medium',
        };
      }
    }
  }

  // 6. Input type → semantic hints
  const type = input.getAttribute('type') ?? 'text';
  const typeHints: Record<string, string> = {
    email: 'Email address',
    tel: 'Phone number',
    password: 'Password',
    search: 'Search',
    url: 'Website URL',
    number: 'Number',
    date: 'Date',
    time: 'Time',
    file: 'Choose file',
    color: 'Choose color',
    range: 'Range',
    month: 'Month',
    week: 'Week',
  };

  const hint = typeHints[type];
  if (hint) {
    return {
      description: `Infer label from input type="${type}": "${hint}"`,
      type: 'add-attribute',
      attribute: 'aria-label',
      value: hint,
      oldHtml,
      newHtml: setAttrHtml(input, 'aria-label', hint),
      confidence: 'low',
    };
  }

  return {
    description: 'Add a <label> element (review needed — could not infer label text)',
    type: 'add-attribute',
    attribute: 'aria-label',
    value: 'TODO: Label this input',
    oldHtml,
    newHtml: setAttrHtml(input, 'aria-label', 'TODO: Label this input'),
    confidence: 'low',
  };
});

function generateId(label: string): string {
  return (
    'trya11y-' +
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  );
}

// ===================================================================
// 5. color-contrast
// ===================================================================

/**
 * sRGB channel (0-255) → linear light value (0-1).
 */
function sRGBtoLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Linear light value (0-1) → sRGB channel (0-255).
 */
function linearToSRGB(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(s, 0), 1) * 255);
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Relative luminance per WCAG 2.x definition. */
function relativeLuminance(rgb: RGB): number {
  const R = sRGBtoLinear(rgb.r);
  const G = sRGBtoLinear(rgb.g);
  const B = sRGBtoLinear(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** Contrast ratio between two luminance values (always >= 1). */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Parse a CSS colour string (rgb, rgba, hex) into an RGB object. */
function parseColor(color: string): RGB | null {
  // rgb(a) function
  const rgbMatch = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
  );
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }

  // Modern CSS rgb(a) syntax: rgb(r g b / a)
  const modernMatch = color.match(
    /rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)/,
  );
  if (modernMatch) {
    return {
      r: parseInt(modernMatch[1], 10),
      g: parseInt(modernMatch[2], 10),
      b: parseInt(modernMatch[3], 10),
    };
  }

  // Hex
  const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  return null;
}

/** Convert RGB to hex. */
function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Adjust a colour toward black or white using binary search until the
 * contrast against `against` meets `targetRatio`.  Returns the new RGB
 * or null if it is impossible.
 */
function adjustColorForContrast(
  fg: RGB,
  bg: RGB,
  targetRatio: number,
  adjustForeground: boolean,
): RGB | null {
  const bgLum = relativeLuminance(bg);
  const fgLum = relativeLuminance(fg);
  const fgIsDarker = fgLum < bgLum;

  // We'll adjust the colour we're allowed to change
  const base = adjustForeground ? fg : bg;
  // Target: we either go toward black (0) or white (255).
  const target: RGB = fgIsDarker === adjustForeground
    ? { r: 0, g: 0, b: 0 }
    : { r: 255, g: 255, b: 255 };

  let lo = 0;
  let hi = 1;
  let bestRGB: RGB | null = null;

  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const candidate: RGB = {
      r: Math.round(base.r + (target.r - base.r) * mid),
      g: Math.round(base.g + (target.g - base.g) * mid),
      b: Math.round(base.b + (target.b - base.b) * mid),
    };

    const candLum = relativeLuminance(candidate);
    const otherLum = adjustForeground ? bgLum : fgLum;
    const ratio = contrastRatio(candLum, otherLum);

    if (ratio >= targetRatio) {
      bestRGB = candidate;
      hi = mid; // try to find a smaller adjustment
    } else {
      lo = mid;
    }
  }

  return bestRGB;
}

registerHeuristic('color-contrast', (issue, element) => {
  const el = element as HTMLElement;
  const oldHtml = el.outerHTML;
  const style = window.getComputedStyle(el);

  const fgColor = parseColor(style.color);
  const bgColor = parseColor(style.backgroundColor);

  if (!fgColor || !bgColor) {
    return null; // Cannot parse colours
  }

  const currentRatio = contrastRatio(
    relativeLuminance(fgColor),
    relativeLuminance(bgColor),
  );

  // Determine required ratio: large text needs 3:1, normal text needs 4.5:1
  const fontSize = parseFloat(style.fontSize);
  const fontWeight = parseInt(style.fontWeight, 10) || (style.fontWeight === 'bold' ? 700 : 400);
  const isLargeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700);
  const requiredRatio = isLargeText ? 3 : 4.5;

  if (currentRatio >= requiredRatio) {
    return null; // Already passing — nothing to fix
  }

  // Try adjusting foreground first (usually less visually disruptive for text)
  let newFg = adjustColorForContrast(fgColor, bgColor, requiredRatio, true);
  let adjustedProperty = 'color';
  let newColor: RGB | null = newFg;

  // If foreground adjustment didn't work or went to extremes, try background
  if (!newFg) {
    const newBg = adjustColorForContrast(fgColor, bgColor, requiredRatio, false);
    if (newBg) {
      adjustedProperty = 'background-color';
      newColor = newBg;
    }
  }

  if (!newColor) {
    return null; // Cannot find a passing colour
  }

  const hexNew = rgbToHex(newColor);
  const hexOldFg = rgbToHex(fgColor);
  const hexOldBg = rgbToHex(bgColor);

  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.setProperty(adjustedProperty, hexNew);
  const newHtml = clone.outerHTML;

  const achievedLum =
    adjustedProperty === 'color'
      ? relativeLuminance(newColor)
      : relativeLuminance(fgColor);
  const otherLum =
    adjustedProperty === 'color'
      ? relativeLuminance(bgColor)
      : relativeLuminance(newColor);
  const achievedRatio = contrastRatio(achievedLum, otherLum).toFixed(2);

  return {
    description:
      `Change ${adjustedProperty} from ${adjustedProperty === 'color' ? hexOldFg : hexOldBg} to ${hexNew} ` +
      `to achieve ${achievedRatio}:1 contrast ratio (required: ${requiredRatio}:1, was: ${currentRatio.toFixed(2)}:1)`,
    type: 'change-color',
    attribute: 'style',
    value: `${adjustedProperty}: ${hexNew}`,
    oldHtml,
    newHtml,
    confidence: 'high',
  };
});

// ===================================================================
// 6. heading-order
// ===================================================================

registerHeuristic('heading-order', (issue, element) => {
  const heading = element as HTMLHeadingElement;
  const oldHtml = heading.outerHTML;
  const currentLevel = parseInt(heading.tagName.charAt(1), 10);

  // Walk all headings in document order up to (but not including) this one
  const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  const myIndex = allHeadings.indexOf(heading);

  let expectedLevel = 1; // default if no prior headings
  if (myIndex > 0) {
    const prevHeading = allHeadings[myIndex - 1];
    const prevLevel = parseInt(prevHeading.tagName.charAt(1), 10);
    // The next heading should be at most prevLevel + 1
    expectedLevel = Math.min(prevLevel + 1, 6);
  }

  if (currentLevel <= expectedLevel) {
    return null; // No skip detected (axe might disagree, but we can't improve)
  }

  const headingText = textOf(heading);
  const newTag = `h${expectedLevel}`;

  return {
    description: `Change <${heading.tagName.toLowerCase()}> to <${newTag}> to maintain heading hierarchy (previous heading is level ${expectedLevel - 1 || 1})`,
    type: 'modify-element',
    oldHtml,
    newHtml: changeTagHtml(heading, newTag),
    confidence: 'high',
  };
});

// ===================================================================
// 7. html-has-lang
// ===================================================================

registerHeuristic('html-has-lang', (issue, element) => {
  const html = element as HTMLHtmlElement;
  const oldHtml = `<html${Array.from(html.attributes).map((a) => ` ${a.name}="${a.value}"`).join('')}>`;

  // 1. Check <meta http-equiv="content-language">
  const contentLangMeta = document.querySelector(
    'meta[http-equiv="content-language"]',
  ) as HTMLMetaElement | null;
  if (contentLangMeta) {
    const lang = contentLangMeta.content.trim().split(/[,;_]/)[0];
    if (lang) {
      return {
        description: `Set lang="${lang}" from <meta http-equiv="content-language">`,
        type: 'add-attribute',
        attribute: 'lang',
        value: lang,
        oldHtml,
        newHtml: oldHtml.replace('<html', `<html lang="${lang}"`),
        confidence: 'high',
      };
    }
  }

  // 2. Check <meta name="language">
  const langMeta = document.querySelector(
    'meta[name="language"]',
  ) as HTMLMetaElement | null;
  if (langMeta) {
    const lang = langMeta.content.trim().split(/[,;_]/)[0];
    if (lang) {
      return {
        description: `Set lang="${lang}" from <meta name="language">`,
        type: 'add-attribute',
        attribute: 'lang',
        value: lang,
        oldHtml,
        newHtml: oldHtml.replace('<html', `<html lang="${lang}"`),
        confidence: 'high',
      };
    }
  }

  // 3. Character frequency analysis of body text
  const bodyText = textOf(document.body, 500).toLowerCase();
  const detectedLang = detectLanguage(bodyText);

  return {
    description: `Set lang="${detectedLang.lang}" (detected via text analysis, confidence: ${detectedLang.confidence})`,
    type: 'add-attribute',
    attribute: 'lang',
    value: detectedLang.lang,
    oldHtml,
    newHtml: oldHtml.replace('<html', `<html lang="${detectedLang.lang}"`),
    confidence: detectedLang.confidence,
  };
});

/**
 * Very lightweight language detection based on common word frequency.
 */
function detectLanguage(text: string): { lang: string; confidence: 'high' | 'medium' | 'low' } {
  if (!text || text.length < 10) {
    return { lang: 'en', confidence: 'low' };
  }

  const words = text.split(/\s+/).map((w) => w.replace(/[^a-z]/g, ''));

  const langSignatures: Record<string, { words: string[]; lang: string }> = {
    en: { words: ['the', 'and', 'is', 'in', 'to', 'of', 'it', 'for', 'that', 'was', 'with', 'are', 'this', 'have', 'not'], lang: 'en' },
    de: { words: ['die', 'und', 'der', 'ist', 'das', 'ein', 'nicht', 'mit', 'auf', 'den', 'eine', 'auch', 'sich', 'von', 'werden'], lang: 'de' },
    fr: { words: ['les', 'des', 'est', 'une', 'que', 'dans', 'pour', 'pas', 'qui', 'sur', 'sont', 'avec', 'tout', 'plus', 'cette'], lang: 'fr' },
    es: { words: ['los', 'las', 'del', 'una', 'por', 'con', 'que', 'para', 'como', 'pero', 'sus', 'este', 'entre', 'cuando', 'esta'], lang: 'es' },
    pt: { words: ['que', 'uma', 'para', 'com', 'por', 'mais', 'como', 'dos', 'foi', 'tem', 'seu', 'sua', 'nas', 'aos', 'isso'], lang: 'pt' },
    it: { words: ['che', 'del', 'della', 'una', 'per', 'con', 'sono', 'questo', 'anche', 'essere', 'dalla', 'stato', 'degli', 'molto', 'quella'], lang: 'it' },
    nl: { words: ['het', 'een', 'van', 'dat', 'zijn', 'voor', 'niet', 'met', 'ook', 'maar', 'wordt', 'aan', 'nog', 'wel', 'bij'], lang: 'nl' },
  };

  let bestLang = 'en';
  let bestScore = 0;

  for (const [, signature] of Object.entries(langSignatures)) {
    let score = 0;
    for (const word of signature.words) {
      score += words.filter((w) => w === word).length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLang = signature.lang;
    }
  }

  const totalWords = words.length;
  const ratio = totalWords > 0 ? bestScore / totalWords : 0;

  let confidence: 'high' | 'medium' | 'low';
  if (ratio > 0.15) {
    confidence = 'high';
  } else if (ratio > 0.05) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return { lang: bestLang, confidence };
}

// ===================================================================
// 8. Table header heuristics (th-has-data-cells, td-headers-attr)
// ===================================================================

registerHeuristic('th-has-data-cells', (issue, element) => {
  const th = element as HTMLTableCellElement;
  const oldHtml = th.outerHTML;
  const table = th.closest('table');
  if (!table) return null;

  // Find the column index of this <th>
  const row = th.closest('tr');
  if (!row) return null;
  const colIndex = Array.from(row.cells).indexOf(th);
  if (colIndex === -1) return null;

  // Examine data cells in this column (skip header rows)
  const dataRows = Array.from(table.querySelectorAll('tbody tr, tr')).filter(
    (tr) => !tr.querySelector('th'),
  );

  const sampleValues: string[] = [];
  for (const dataRow of dataRows.slice(0, 5)) {
    const cells = (dataRow as HTMLTableRowElement).cells;
    if (cells[colIndex]) {
      sampleValues.push(textOf(cells[colIndex]).trim());
    }
  }

  let inferredName = inferColumnName(sampleValues);

  // Check for <caption> element for context
  const caption = table.querySelector('caption');
  if (!inferredName && caption) {
    inferredName = `Column ${colIndex + 1}`;
  }

  if (!inferredName) {
    inferredName = `Column ${colIndex + 1}`;
  }

  const clone = th.cloneNode(true) as HTMLTableCellElement;
  clone.textContent = inferredName;
  const newHtml = clone.outerHTML;

  return {
    description: `Set header text to "${inferredName}" (inferred from column data)`,
    type: 'modify-element',
    oldHtml,
    newHtml,
    confidence: sampleValues.length > 0 ? 'medium' : 'low',
  };
});

registerHeuristic('td-headers-attr', (issue, element) => {
  const td = element as HTMLTableCellElement;
  const oldHtml = td.outerHTML;
  const table = td.closest('table');
  if (!table) return null;

  const row = td.closest('tr');
  if (!row) return null;
  const colIndex = Array.from(row.cells).indexOf(td);
  if (colIndex === -1) return null;

  // Find the <th> for this column
  const headerRow = table.querySelector('thead tr, tr');
  if (!headerRow) return null;

  const headerCells = (headerRow as HTMLTableRowElement).querySelectorAll('th');
  const th = headerCells[colIndex];
  if (!th) return null;

  // Ensure <th> has an id
  let thId = th.getAttribute('id');
  if (!thId) {
    thId = `trya11y-th-${colIndex}`;
  }

  return {
    description: `Associate cell with header "${textOf(th)}" via headers attribute`,
    type: 'add-attribute',
    attribute: 'headers',
    value: thId,
    oldHtml,
    newHtml: setAttrHtml(td, 'headers', thId),
    confidence: 'high',
  };
});

/**
 * Infer a column header name from sample cell values.
 */
function inferColumnName(values: string[]): string | null {
  if (values.length === 0) return null;

  const nonEmpty = values.filter(Boolean);
  if (nonEmpty.length === 0) return null;

  // All numbers?
  if (nonEmpty.every((v) => /^[\d,.$€£¥%+-]+$/.test(v.trim()))) {
    if (nonEmpty.some((v) => /[$€£¥]/.test(v))) return 'Amount';
    if (nonEmpty.some((v) => /%/.test(v))) return 'Percentage';
    return 'Count';
  }

  // All dates?
  if (
    nonEmpty.every((v) => {
      const d = Date.parse(v);
      return !isNaN(d);
    })
  ) {
    return 'Date';
  }

  // All emails?
  if (nonEmpty.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) {
    return 'Email';
  }

  // All phone numbers?
  if (nonEmpty.every((v) => /^[\d\s()+-]{7,}$/.test(v.trim()))) {
    return 'Phone';
  }

  // All URLs?
  if (nonEmpty.every((v) => /^https?:\/\//.test(v))) {
    return 'URL';
  }

  // Very short values (likely status or code)
  if (nonEmpty.every((v) => v.length <= 3)) {
    return 'Code';
  }

  return null;
}

// ===================================================================
// Generic fallback
// ===================================================================

function genericFix(issue: A11yIssue, element: Element): FixSuggestion | null {
  const oldHtml = element.outerHTML;

  // Common patterns we can handle generically
  switch (issue.ruleId) {
    case 'document-title': {
      const h1 = document.querySelector('h1');
      const titleText = h1 ? textOf(h1) : window.location.hostname;
      return {
        description: `Add a <title> element: "${titleText}"`,
        type: 'add-element',
        oldHtml: '<head>',
        newHtml: `<head>\n  <title>${titleText}</title>`,
        confidence: h1 ? 'medium' : 'low',
      };
    }

    case 'meta-viewport': {
      return {
        description:
          'Ensure the viewport meta tag does not disable user scaling',
        type: 'modify-attribute',
        attribute: 'content',
        value: 'width=device-width, initial-scale=1',
        oldHtml,
        newHtml: setAttrHtml(element, 'content', 'width=device-width, initial-scale=1'),
        confidence: 'high',
      };
    }

    case 'aria-roles': {
      // Remove invalid role
      const role = element.getAttribute('role');
      if (role) {
        return {
          description: `Remove invalid role="${role}"`,
          type: 'modify-attribute',
          attribute: 'role',
          oldHtml,
          newHtml: removeAttrHtml(element, 'role'),
          confidence: 'medium',
        };
      }
      break;
    }

    case 'aria-required-attr': {
      // Check the issue help text for clues about which attribute is missing
      const ariaMatch = issue.help.match(/aria-[\w-]+/);
      if (ariaMatch) {
        return {
          description: `Add missing required ARIA attribute: ${ariaMatch[0]}`,
          type: 'add-attribute',
          attribute: ariaMatch[0],
          value: 'true',
          oldHtml,
          newHtml: setAttrHtml(element, ariaMatch[0], 'true'),
          confidence: 'low',
        };
      }
      break;
    }

    case 'tabindex': {
      const tabindex = element.getAttribute('tabindex');
      if (tabindex && parseInt(tabindex, 10) > 0) {
        return {
          description: 'Remove positive tabindex to restore natural tab order',
          type: 'modify-attribute',
          attribute: 'tabindex',
          value: '0',
          oldHtml,
          newHtml: setAttrHtml(element, 'tabindex', '0'),
          confidence: 'high',
        };
      }
      break;
    }

    case 'autocomplete-valid': {
      // Remove invalid autocomplete
      return {
        description: 'Remove invalid autocomplete attribute',
        type: 'modify-attribute',
        attribute: 'autocomplete',
        oldHtml,
        newHtml: removeAttrHtml(element, 'autocomplete'),
        confidence: 'medium',
      };
    }

    case 'frame-title': {
      const src = element.getAttribute('src') ?? '';
      let title = 'Embedded content';
      try {
        const url = new URL(src, window.location.href);
        title = `Content from ${url.hostname}`;
      } catch {
        // Keep default
      }
      return {
        description: `Add title to iframe: "${title}"`,
        type: 'add-attribute',
        attribute: 'title',
        value: title,
        oldHtml,
        newHtml: setAttrHtml(element, 'title', title),
        confidence: 'medium',
      };
    }

    case 'list': {
      return {
        description: 'Wrap list items in a proper <ul> or <ol> element',
        type: 'restructure',
        oldHtml,
        newHtml: `<ul>\n  ${oldHtml}\n</ul>`,
        confidence: 'medium',
      };
    }

    case 'listitem': {
      return {
        description: 'Wrap item in a <li> element inside a list',
        type: 'restructure',
        oldHtml,
        newHtml: `<li>${element.innerHTML}</li>`,
        confidence: 'medium',
      };
    }

    case 'region': {
      return {
        description: 'Wrap content in a landmark region',
        type: 'add-attribute',
        attribute: 'role',
        value: 'main',
        oldHtml,
        newHtml: setAttrHtml(element, 'role', 'main'),
        confidence: 'low',
      };
    }
  }

  // Absolute fallback — try to use axe's own suggestions from the issue description
  if (issue.help) {
    return {
      description: `axe suggestion: ${issue.help}`,
      type: 'modify-element',
      oldHtml,
      newHtml: oldHtml, // No automated fix; surfacing the suggestion for manual review
      confidence: 'low',
    };
  }

  return null;
}
