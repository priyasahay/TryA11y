// --------------------------------------------------------------------------
// @trya11y/core — DOM patching engine
//
// Applies and reverts accessibility fixes on the live page.  Every mutation
// is tracked so it can be perfectly undone.
// --------------------------------------------------------------------------

import type { PatchOperation, FixSuggestion, A11yIssue } from './types.js';

// ---------------------------------------------------------------------------
// Convert a FixSuggestion into low-level PatchOperations
// ---------------------------------------------------------------------------

export function fixToPatchOps(issue: A11yIssue, fix: FixSuggestion): PatchOperation[] {
  const selector = issue.element.selector;
  const ops: PatchOperation[] = [];

  switch (fix.type) {
    case 'add-attribute':
    case 'modify-attribute': {
      if (fix.attribute) {
        ops.push({
          issueId: issue.id,
          selector,
          type: 'setAttribute',
          attribute: fix.attribute,
          value: fix.value ?? '',
        });
      }
      break;
    }

    case 'change-color': {
      // The fix value looks like "color: #123456" or "background-color: #abcdef"
      if (fix.value) {
        const [prop, ...rest] = fix.value.split(':');
        const cssValue = rest.join(':').trim();
        ops.push({
          issueId: issue.id,
          selector,
          type: 'setStyle',
          attribute: prop.trim(),
          value: cssValue,
        });
      }
      break;
    }

    case 'modify-element':
    case 'add-element': {
      ops.push({
        issueId: issue.id,
        selector,
        type: 'replaceElement',
        newElement: fix.newHtml,
      });
      break;
    }

    case 'restructure': {
      ops.push({
        issueId: issue.id,
        selector,
        type: 'replaceElement',
        newElement: fix.newHtml,
      });
      break;
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Apply a batch of patch operations; return an undo function
// ---------------------------------------------------------------------------

/**
 * Apply a batch of DOM patch operations and return an undo function.
 *
 * @param operations - The low-level patch operations to apply in order.
 * @returns A function that reverts every applied operation in reverse order.
 */
export function applyPatches(operations: PatchOperation[]): () => void {
  const undoSteps: Array<() => void> = [];

  for (const op of operations) {
    const el = document.querySelector(op.selector);
    if (!el) continue;

    switch (op.type) {
      // ---- setAttribute ----
      case 'setAttribute': {
        const attr = op.attribute!;
        const hadAttr = el.hasAttribute(attr);
        const prevValue = el.getAttribute(attr);
        el.setAttribute(attr, op.value ?? '');

        // Store original for undo
        op.oldValue = prevValue ?? undefined;

        undoSteps.push(() => {
          if (hadAttr && prevValue !== null) {
            el.setAttribute(attr, prevValue);
          } else {
            el.removeAttribute(attr);
          }
        });
        break;
      }

      // ---- removeAttribute ----
      case 'removeAttribute': {
        const attr = op.attribute!;
        const prevValue = el.getAttribute(attr);
        if (prevValue !== null) {
          el.removeAttribute(attr);
          op.oldValue = prevValue;

          undoSteps.push(() => {
            el.setAttribute(attr, prevValue);
          });
        }
        break;
      }

      // ---- replaceElement ----
      case 'replaceElement': {
        const parent = el.parentNode;
        if (!parent || !op.newElement) break;

        // Preserve original DOM node
        const originalNode = el.cloneNode(true) as Element;
        const originalOuterHTML = el.outerHTML;

        // Create new element(s) from the HTML string
        const template = document.createElement('template');
        template.innerHTML = op.newElement.trim();
        const newContent = template.content;

        // Collect references to inserted nodes so we can remove them during undo
        const insertedNodes: Node[] = Array.from(newContent.childNodes).map(
          (n) => n.cloneNode(true),
        );

        // Replace old element with new content
        const placeholder = document.createComment(`trya11y-patch:${op.issueId}`);
        parent.replaceChild(placeholder, el);

        for (const node of insertedNodes) {
          parent.insertBefore(node, placeholder);
        }

        undoSteps.push(() => {
          // Remove inserted nodes
          for (const node of insertedNodes) {
            if (node.parentNode === parent) {
              parent.removeChild(node);
            }
          }
          // Restore original element in place of the comment
          const restoreTemplate = document.createElement('template');
          restoreTemplate.innerHTML = originalOuterHTML;
          const restored = restoreTemplate.content.firstElementChild;
          if (restored && placeholder.parentNode) {
            placeholder.parentNode.replaceChild(restored, placeholder);
          }
        });
        break;
      }

      // ---- wrapElement ----
      case 'wrapElement': {
        const parent = el.parentNode;
        if (!parent || !op.newElement) break;

        // The newElement is the wrapper HTML; the existing element goes inside
        const wrapper = document.createElement('template');
        wrapper.innerHTML = op.newElement.trim();
        const wrapperEl = wrapper.content.firstElementChild;
        if (!wrapperEl) break;

        // Insert wrapper before the element, move element inside
        parent.insertBefore(wrapperEl, el);
        wrapperEl.appendChild(el);

        undoSteps.push(() => {
          // Unwrap: move the original element back and remove the wrapper
          if (wrapperEl.parentNode) {
            wrapperEl.parentNode.insertBefore(el, wrapperEl);
            wrapperEl.parentNode.removeChild(wrapperEl);
          }
        });
        break;
      }

      // ---- setStyle ----
      case 'setStyle': {
        const htmlEl = el as HTMLElement;
        const prop = op.attribute!;
        const prevValue = htmlEl.style.getPropertyValue(prop);
        const prevPriority = htmlEl.style.getPropertyPriority(prop);

        htmlEl.style.setProperty(prop, op.value ?? '');
        op.oldValue = prevValue;

        undoSteps.push(() => {
          if (prevValue) {
            htmlEl.style.setProperty(prop, prevValue, prevPriority);
          } else {
            htmlEl.style.removeProperty(prop);
          }
        });
        break;
      }
    }
  }

  // Return a single function that undoes every operation in reverse order
  return () => {
    for (let i = undoSteps.length - 1; i >= 0; i--) {
      undoSteps[i]();
    }
  };
}

// ---------------------------------------------------------------------------
// Convenience: apply a single fix and get its undo function
// ---------------------------------------------------------------------------

/**
 * Apply a single suggested fix and return an undo function.
 *
 * @param issue - The accessibility issue that anchors the fix selector.
 * @param fix - The high-level fix suggestion to convert and apply.
 * @returns A function that reverts the applied DOM changes.
 */
export function applyFix(issue: A11yIssue, fix: FixSuggestion): () => void {
  const ops = fixToPatchOps(issue, fix);
  return applyPatches(ops);
}

// ---------------------------------------------------------------------------
// Element highlighting — visual overlay for issue inspection
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#d32f2f',
  serious: '#f57c00',
  moderate: '#fbc02d',
  minor: '#1976d2',
};

const SEVERITY_BG: Record<string, string> = {
  critical: 'rgba(211, 47, 47, 0.08)',
  serious: 'rgba(245, 124, 0, 0.08)',
  moderate: 'rgba(251, 192, 45, 0.08)',
  minor: 'rgba(25, 118, 210, 0.08)',
};

/**
 * Create a coloured overlay positioned over the target element.
 * Returns a function that removes the overlay.
 */
export function highlightElement(selector: string, severity: string): () => void {
  const el = document.querySelector(selector);
  if (!el) return () => {};

  const rect = el.getBoundingClientRect();
  const scrollX = window.scrollX || document.documentElement.scrollLeft;
  const scrollY = window.scrollY || document.documentElement.scrollTop;

  const borderColor = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.moderate;
  const bgColor = SEVERITY_BG[severity] ?? SEVERITY_BG.moderate;

  // Create the overlay element
  const overlay = document.createElement('div');
  overlay.className = 'trya11y-highlight';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.dataset.trya11ySeverity = severity;

  Object.assign(overlay.style, {
    position: 'absolute',
    top: `${rect.top + scrollY}px`,
    left: `${rect.left + scrollX}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    border: `2px solid ${borderColor}`,
    backgroundColor: bgColor,
    pointerEvents: 'none',
    zIndex: '2147483647',
    boxSizing: 'border-box',
    borderRadius: '2px',
    transition: 'opacity 0.2s ease',
  } satisfies Partial<CSSStyleDeclaration>);

  // Add a small severity badge in the top-right corner
  const badge = document.createElement('span');
  Object.assign(badge.style, {
    position: 'absolute',
    top: '-10px',
    right: '-10px',
    padding: '1px 6px',
    fontSize: '10px',
    fontWeight: '700',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#fff',
    backgroundColor: borderColor,
    borderRadius: '8px',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  badge.textContent = severity;
  overlay.appendChild(badge);

  document.body.appendChild(overlay);

  // Return cleanup function
  return () => {
    overlay.style.opacity = '0';
    // Remove after transition
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 200);
  };
}

function clearHighlights(): void {
  const overlays = document.querySelectorAll('.trya11y-highlight');
  overlays.forEach((overlay) => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  });
}
