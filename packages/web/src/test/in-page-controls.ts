// -----------------------------------------------------------------------------
// The browser audits' readers of a page's controls.
//
// Each function below runs inside the page: an end-to-end audit hands it to
// Playwright's page.evaluate, which sends its source to the browser. So each
// is self-contained (it uses nothing declared outside itself, not even another
// export of this file), and this file imports nothing.
//
// They live under src so that a unit test can run the very same code against
// controls it builds (src/__tests__/browser-audit-controls.test.tsx). The
// audits' rule for a control no person can reach is pinned there, with no
// end-to-end case of its own.
// -----------------------------------------------------------------------------

/** A control the accessibility audit found with no accessible name. */
export interface ControlNameIssue {
  readonly selector: string;
  readonly tagName: string;
  readonly role: string | null;
}

/** A control the button audit found drawn on the page. */
export interface VisibleControlSnapshot {
  readonly tagName: string;
  readonly role: string | null;
  readonly label: string;
  readonly rawHref: string | null;
  readonly disabled: boolean;
  readonly width: number;
  readonly height: number;
}

/** Every control that is drawn, enabled and within a person's reach, and has
 *  no accessible name (e2e/support/accessibility-audit.ts). */
export function unnamedControlsInPage(): ControlNameIssue[] {
  const selector = [
    "button",
    "a[href]",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='tab']",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  function isVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function selectorFor(element: Element): string {
    const id = element.id.length > 0 ? `#${element.id}` : "";
    const testId = element.getAttribute("data-testid");
    const testIdPart = testId !== null && testId.trim().length > 0 ? `[data-testid="${testId.trim()}"]` : "";
    const ariaLabel = element.getAttribute("aria-label");
    const ariaPart = ariaLabel !== null && ariaLabel.trim().length > 0 ? `[aria-label="${ariaLabel.trim().slice(0, 60)}"]` : "";
    const role = element.getAttribute("role");
    const rolePart = role !== null && role.trim().length > 0 ? `[role="${role.trim()}"]` : "";
    const className = element.classList.length > 0 ? `.${Array.from(element.classList).slice(0, 2).join(".")}` : "";
    const text = (element.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 60);
    const textPart = text.length > 0 ? ` text="${text}"` : "";
    return `${element.tagName.toLowerCase()}${id}${testIdPart}${ariaPart}${rolePart}${className}${textPart}`;
  }

  function labelText(element: Element): string {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      return "";
    }
    return Array.from(element.labels ?? [])
      .map((label) => label.textContent?.trim() ?? "")
      .filter((text) => text.length > 0)
      .join(" ");
  }

  function accessibleName(element: Element): string {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel !== null && ariaLabel.trim().length > 0) return ariaLabel.trim();

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy !== null && labelledBy.trim().length > 0) {
      const named = labelledBy
        .split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter((part) => part.length > 0)
        .join(" ");
      if (named.trim().length > 0) return named.trim();
    }

    const label = labelText(element);
    if (label.length > 0) return label;

    if (element instanceof HTMLInputElement && (element.type === "button" || element.type === "submit" || element.type === "reset")) {
      return element.value.trim();
    }

    const title = element.getAttribute("title");
    if (title !== null && title.trim().length > 0) return title.trim();

    return element.textContent?.trim() ?? "";
  }

  /** A control no person can reach has no name to audit: hidden from
   *  assistive technology by an aria-hidden ancestor, out of the tab order,
   *  and drawn wholly off the page, left of or above its origin, where no
   *  scroll reaches. All three together, never one alone: an aria-hidden
   *  control drawn on the page is a defect and is still reported. */
  function isOutOfEveryReach(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest("[aria-hidden='true']") === null || element.tabIndex >= 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.right + window.scrollX <= 0 || rect.bottom + window.scrollY <= 0;
  }

  return Array.from(document.querySelectorAll(selector))
    .filter((element) => isVisible(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true")
    .filter((element) => !isOutOfEveryReach(element))
    .filter((element) => accessibleName(element).length === 0)
    .map((element) => ({
      selector: selectorFor(element),
      tagName: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
    }));
}

/** Every control that is drawn and within a person's reach, as the button
 *  audit reads it (e2e/button-action-audit.spec.ts). */
export function visibleControlsInPage(): VisibleControlSnapshot[] {
  const selector = [
    "button",
    "a[href]",
    "[role='button']",
    "[role='tab']",
    "[role='menuitem']",
    "[role='menuitemcheckbox']",
    "[role='checkbox']",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
  ].join(",");

  function textFromLabelledBy(element: Element): string {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy === null) return "";
    return labelledBy
      .split(/\s+/u)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter((text) => text.length > 0)
      .join(" ");
  }

  function textFromAssociatedLabel(element: Element): string {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      return "";
    }
    if (element.labels !== null && element.labels.length > 0) {
      return Array.from(element.labels)
        .map((label) => label.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
        .join(" ");
    }
    return "";
  }

  function controlLabel(element: Element): string {
    return [
      element.getAttribute("aria-label"),
      textFromLabelledBy(element),
      textFromAssociatedLabel(element),
      element.getAttribute("title"),
      element.getAttribute("placeholder"),
      element instanceof HTMLInputElement ? element.value : null,
      element.textContent,
    ]
      .map((value) => value?.replace(/\s+/gu, " ").trim() ?? "")
      .find((value) => value.length > 0) ?? "";
  }

  function isVisibleControl(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0;
  }

  /** A control no person can reach is not one this audit asks a name or a
   *  size of: hidden from assistive technology by an aria-hidden ancestor,
   *  out of the tab order, and drawn wholly off the page, left of or above
   *  its origin, where no scroll reaches. All three together, never one
   *  alone: an aria-hidden control drawn on the page is still audited. */
  function isOutOfEveryReach(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest("[aria-hidden='true']") === null || element.tabIndex >= 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.right + window.scrollX <= 0 || rect.bottom + window.scrollY <= 0;
  }

  return Array.from(document.querySelectorAll(selector))
    .filter((element) => isVisibleControl(element) && !isOutOfEveryReach(element))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const disabled = element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
        ? element.disabled
        : element.getAttribute("aria-disabled") === "true";
      return {
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        label: controlLabel(element),
        rawHref: element instanceof HTMLAnchorElement ? element.getAttribute("href") : null,
        disabled,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
}
