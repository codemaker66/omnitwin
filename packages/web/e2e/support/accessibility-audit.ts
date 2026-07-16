import { expect, type Page } from "@playwright/test";

export type AccessibilityViewportName = "desktop" | "tablet" | "mobile";

export interface AccessibilityViewport {
  readonly name: AccessibilityViewportName;
  readonly width: number;
  readonly height: number;
}

export interface AccessibilityPageProblems {
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
}

export interface LandmarkAudit {
  readonly mainCount: number;
  readonly mainNames: readonly string[];
  readonly unnamedNavCount: number;
  readonly navNames: readonly string[];
}

export interface ControlNameIssue {
  readonly selector: string;
  readonly tagName: string;
  readonly role: string | null;
}

export interface FocusIssue {
  readonly step: number;
  readonly selector: string;
  readonly name: string;
  readonly reason: string;
}

export interface MotionOffender {
  readonly selector: string;
  readonly transitionProperty: string;
  readonly transitionMs: number;
  readonly animationMs: number;
  readonly inlineTransition: string;
  readonly reducedMotionActive: boolean;
  readonly matchedTransitionRules: readonly string[];
}

export interface ContrastOffender {
  readonly selector: string;
  readonly text: string;
  readonly ratio: number;
  readonly threshold: number;
  readonly fontSize: number;
  readonly fontWeight: number;
}

export interface AccessibilityAuditResult {
  readonly name: string;
  readonly path: string;
  readonly viewport: AccessibilityViewport | null;
  readonly landmarks: LandmarkAudit;
  readonly unnamedControls: readonly ControlNameIssue[];
  readonly focusIssues: readonly FocusIssue[];
  readonly motionOffenders: readonly MotionOffender[];
  readonly contrastOffenders: readonly ContrastOffender[];
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
}

export interface AccessibilityAuditOptions {
  readonly name: string;
  readonly path: string;
  readonly problems: AccessibilityPageProblems;
  readonly viewport?: AccessibilityViewport;
  readonly requireSingleNamedMain?: boolean;
  readonly maxFocusSteps?: number;
}

export function watchPageProblems(page: Page): AccessibilityPageProblems {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      !text.startsWith("Failed to load resource:") &&
      !text.includes("favicon.ico")
    ) {
      consoleErrors.push(text);
    }
  });

  return { pageErrors, consoleErrors };
}

async function collectLandmarkAudit(page: Page): Promise<LandmarkAudit> {
  return page.evaluate(() => {
    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    function accessibleName(element: Element): string {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel !== null && ariaLabel.trim().length > 0) return ariaLabel.trim();

      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy !== null && labelledBy.trim().length > 0) {
        return labelledBy
          .split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .filter((part) => part.length > 0)
          .join(" ")
          .trim();
      }

      return element.textContent?.trim() ?? "";
    }

    const mains = Array.from(document.querySelectorAll("main")).filter(isVisible);
    const navs = Array.from(document.querySelectorAll("nav")).filter(isVisible);
    const navNames = navs.map(accessibleName);

    return {
      mainCount: mains.length,
      mainNames: mains.map(accessibleName),
      unnamedNavCount: navNames.filter((name) => name.length === 0).length,
      navNames,
    };
  });
}

async function collectUnnamedControls(page: Page): Promise<ControlNameIssue[]> {
  return page.evaluate(() => {
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

    return Array.from(document.querySelectorAll(selector))
      .filter((element) => isVisible(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true")
      .filter((element) => accessibleName(element).length === 0)
      .map((element) => ({
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
      }));
  });
}

async function collectFocusIssues(page: Page, maxFocusSteps: number): Promise<FocusIssue[]> {
  const focusableCount = await page.evaluate(() => {
    const selector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([type='hidden']):not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "summary",
      "[role='button']:not([aria-disabled='true'])",
      "[role='tab']:not([aria-disabled='true'])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }).length;
  });

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement) {
      document.activeElement.blur();
    }
  });

  const issues: FocusIssue[] = [];
  const steps = Math.min(focusableCount, maxFocusSteps);

  for (let index = 0; index < steps; index += 1) {
    await page.keyboard.press("Tab");
    if (index === 0) {
      const landedOnElement = await page.evaluate(() => document.activeElement instanceof Element && document.activeElement !== document.body);
      if (!landedOnElement) {
        await page.evaluate(() => {
          const selector = [
            "button:not([disabled])",
            "a[href]",
            "input:not([type='hidden']):not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            "summary",
            "[role='button']:not([aria-disabled='true'])",
            "[role='tab']:not([aria-disabled='true'])",
            "[tabindex]:not([tabindex='-1'])",
          ].join(",");

          const first = Array.from(document.querySelectorAll(selector)).find((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });

          if (first instanceof HTMLElement || first instanceof SVGElement) first.focus();
        });
      }
    }
    const snapshot = await page.evaluate((step) => {
      function selectorFor(element: Element): string {
        const id = element.id.length > 0 ? `#${element.id}` : "";
        const className = element.classList.length > 0 ? `.${Array.from(element.classList).slice(0, 2).join(".")}` : "";
        return `${element.tagName.toLowerCase()}${id}${className}`;
      }

      function accessibleName(element: Element): string {
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel !== null && ariaLabel.trim().length > 0) return ariaLabel.trim();

        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy !== null && labelledBy.trim().length > 0) {
          return labelledBy
            .split(/\s+/u)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .filter((part) => part.length > 0)
            .join(" ")
            .trim();
        }

        const title = element.getAttribute("title");
        if (title !== null && title.trim().length > 0) return title.trim();

        return element.textContent?.trim() ?? "";
      }

      const element = document.activeElement;
      if (!(element instanceof Element) || element === document.body) {
        return {
          ok: false,
          step,
          selector: "body",
          name: "",
          reason: "Tab did not land on a focusable element.",
        };
      }

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const outlineWidth = Number.parseFloat(style.outlineWidth);
      const hasOutline = style.outlineStyle !== "none" && Number.isFinite(outlineWidth) && outlineWidth > 0;
      const hasShadow = style.boxShadow !== "none";
      const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";

      return {
        ok: visible && (hasOutline || hasShadow),
        step,
        selector: selectorFor(element),
        name: accessibleName(element),
        reason: visible ? "Focused element has no visible outline or shadow." : "Focused element is not visible.",
      };
    }, index + 1);

    if (!snapshot.ok) {
      if (snapshot.selector === "body" && index > 0) {
        break;
      }
      issues.push({
        step: snapshot.step,
        selector: snapshot.selector,
        name: snapshot.name,
        reason: snapshot.reason,
      });
    }
  }

  return issues;
}

async function collectMotionOffenders(page: Page): Promise<MotionOffender[]> {
  return page.evaluate(() => {
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

    function cssTimeListToMs(value: string): number {
      return Math.max(0, ...value.split(",").map((part) => {
        const trimmed = part.trim();
        if (trimmed.endsWith("ms")) return Number.parseFloat(trimmed);
        if (trimmed.endsWith("s")) return Number.parseFloat(trimmed) * 1000;
        return 0;
      }).filter((duration) => Number.isFinite(duration)));
    }

    function matchedTransitionRules(element: Element): string[] {
      const out: string[] = [];

      function visitRules(rules: CSSRuleList): void {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) {
            const transition = rule.style.getPropertyValue("transition");
            const transitionProperty = rule.style.getPropertyValue("transition-property");
            const transitionDuration = rule.style.getPropertyValue("transition-duration");
            if ((transition.length > 0 || transitionProperty.length > 0 || transitionDuration.length > 0) && safeMatches(element, rule.selectorText)) {
              out.push(`${rule.selectorText} { transition: ${transition}; transition-property: ${transitionProperty}; transition-duration: ${transitionDuration}; }`);
            }
          } else if (rule instanceof CSSMediaRule && window.matchMedia(rule.conditionText).matches) {
            visitRules(rule.cssRules);
          } else if (rule instanceof CSSSupportsRule) {
            visitRules(rule.cssRules);
          }
        }
      }

      function safeMatches(elementToCheck: Element, selector: string): boolean {
        try {
          return elementToCheck.matches(selector);
        } catch {
          return false;
        }
      }

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          visitRules(sheet.cssRules);
        } catch {
          continue;
        }
      }

      return out.slice(0, 12);
    }

    return Array.from(document.querySelectorAll("body *"))
      .filter(isVisible)
      .map((element) => {
        const style = window.getComputedStyle(element);
        return {
          selector: selectorFor(element),
          transitionProperty: style.transitionProperty,
          transitionMs: cssTimeListToMs(style.transitionDuration),
          animationMs: cssTimeListToMs(style.animationDuration),
          inlineTransition: element instanceof HTMLElement ? element.style.transition : "",
          reducedMotionActive: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          matchedTransitionRules: matchedTransitionRules(element),
        };
      })
      .filter((item) => (item.transitionProperty !== "none" && item.transitionMs > 20) || item.animationMs > 20)
      .slice(0, 25);
  });
}

async function collectContrastOffenders(page: Page): Promise<ContrastOffender[]> {
  return page.evaluate(() => {
    interface Rgba {
      readonly r: number;
      readonly g: number;
      readonly b: number;
      readonly a: number;
    }

    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity) > 0.45;
    }

    function selectorFor(element: Element): string {
      const id = element.id.length > 0 ? `#${element.id}` : "";
      const className = element.classList.length > 0 ? `.${Array.from(element.classList).slice(0, 2).join(".")}` : "";
      return `${element.tagName.toLowerCase()}${id}${className}`;
    }

    function clampByte(value: number): number {
      return Math.min(255, Math.max(0, value));
    }

    function channelToSrgb(value: number): number {
      const clamped = Math.min(1, Math.max(0, value));
      return clamped <= 0.0031308
        ? 12.92 * clamped
        : (1.055 * (clamped ** (1 / 2.4))) - 0.055;
    }

    function oklabToSrgbBytes(lightness: number, aAxis: number, bAxis: number): Pick<Rgba, "r" | "g" | "b"> {
      const long = lightness + (0.3963377774 * aAxis) + (0.2158037573 * bAxis);
      const medium = lightness - (0.1055613458 * aAxis) - (0.0638541728 * bAxis);
      const short = lightness - (0.0894841775 * aAxis) - (1.2914855480 * bAxis);
      const longCubed = long ** 3;
      const mediumCubed = medium ** 3;
      const shortCubed = short ** 3;

      const linearR = (4.0767416621 * longCubed) - (3.3077115913 * mediumCubed) + (0.2309699292 * shortCubed);
      const linearG = (-1.2684380046 * longCubed) + (2.6097574011 * mediumCubed) - (0.3413193965 * shortCubed);
      const linearB = (-0.0041960863 * longCubed) - (0.7034186147 * mediumCubed) + (1.7076147010 * shortCubed);

      return {
        r: clampByte(channelToSrgb(linearR) * 255),
        g: clampByte(channelToSrgb(linearG) * 255),
        b: clampByte(channelToSrgb(linearB) * 255),
      };
    }

    function parseCssNumber(part: string): number {
      const trimmed = part.trim();
      if (trimmed.endsWith("%")) return Number.parseFloat(trimmed) / 100;
      return Number.parseFloat(trimmed);
    }

    function splitColorComponents(body: string): { channels: readonly string[]; alpha: number } {
      const [channelPart = "", alphaPart] = body.split("/");
      const channels = channelPart
        .trim()
        .split(/\s+|,/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      const alpha = alphaPart === undefined ? 1 : parseCssNumber(alphaPart);
      return { channels, alpha: Number.isFinite(alpha) ? alpha : 1 };
    }

    function parseCssColor(value: string): Rgba | null {
      const trimmed = value.trim().toLowerCase();
      const rgbMatch = trimmed.match(/^rgba?\((.*)\)$/u);
      if (rgbMatch !== null) {
        const { channels, alpha } = splitColorComponents(rgbMatch[1] ?? "");
        if (channels.length < 3) return null;
        const legacyAlpha = channels.length >= 4 ? parseCssNumber(channels[3] ?? "") : alpha;
        const rgb = channels.slice(0, 3).map((part) => {
          const parsed = parseCssNumber(part);
          return part.endsWith("%") ? parsed * 255 : parsed;
        });
        if (rgb.some((part) => !Number.isFinite(part)) || !Number.isFinite(legacyAlpha)) return null;
        return {
          r: clampByte(rgb[0] ?? 0),
          g: clampByte(rgb[1] ?? 0),
          b: clampByte(rgb[2] ?? 0),
          a: Math.min(1, Math.max(0, legacyAlpha)),
        };
      }

      const oklabMatch = trimmed.match(/^oklab\((.*)\)$/u);
      if (oklabMatch !== null) {
        const { channels, alpha } = splitColorComponents(oklabMatch[1] ?? "");
        if (channels.length < 3) return null;
        const lightness = parseCssNumber(channels[0] ?? "");
        const aAxis = parseCssNumber(channels[1] ?? "");
        const bAxis = parseCssNumber(channels[2] ?? "");
        if (![lightness, aAxis, bAxis].every(Number.isFinite)) return null;
        return {
          ...oklabToSrgbBytes(lightness, aAxis, bAxis),
          a: Math.min(1, Math.max(0, alpha)),
        };
      }

      const oklchMatch = trimmed.match(/^oklch\((.*)\)$/u);
      if (oklchMatch !== null) {
        const { channels, alpha } = splitColorComponents(oklchMatch[1] ?? "");
        if (channels.length < 3) return null;
        const lightness = parseCssNumber(channels[0] ?? "");
        const chroma = parseCssNumber(channels[1] ?? "");
        const hueDegrees = Number.parseFloat(channels[2] ?? "");
        if (![lightness, chroma, hueDegrees].every(Number.isFinite)) return null;
        const hueRadians = (hueDegrees / 180) * Math.PI;
        return {
          ...oklabToSrgbBytes(lightness, chroma * Math.cos(hueRadians), chroma * Math.sin(hueRadians)),
          a: Math.min(1, Math.max(0, alpha)),
        };
      }

      return null;
    }

    function splitBackgroundLayers(value: string): string[] {
      const layers: string[] = [];
      let depth = 0;
      let start = 0;
      for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (char === "(") depth += 1;
        if (char === ")") depth = Math.max(0, depth - 1);
        if (char === "," && depth === 0) {
          layers.push(value.slice(start, index).trim());
          start = index + 1;
        }
      }
      layers.push(value.slice(start).trim());
      return layers.filter((layer) => layer.length > 0 && layer !== "none");
    }

    function averageLayerColor(layer: string): Rgba | null {
      const colors = Array.from(layer.matchAll(/(?:rgba?|oklab|oklch)\([^)]+\)/giu))
        .map((match) => parseCssColor(match[0]))
        .filter((color): color is Rgba => color !== null);

      if (colors.length === 0) return null;

      return {
        r: colors.reduce((sum, color) => sum + color.r, 0) / colors.length,
        g: colors.reduce((sum, color) => sum + color.g, 0) / colors.length,
        b: colors.reduce((sum, color) => sum + color.b, 0) / colors.length,
        a: colors.reduce((sum, color) => sum + color.a, 0) / colors.length,
      };
    }

    function parseBackgroundImageColor(value: string): Rgba | null {
      const layers = splitBackgroundLayers(value)
        .map(averageLayerColor)
        .filter((color): color is Rgba => color !== null && color.a > 0);

      if (layers.length === 0) return null;

      return layers
        .reverse()
        .reduce((background, layer) => blend(layer, background), { r: 0, g: 0, b: 0, a: 0 });
    }

    function blend(foreground: Rgba, background: Rgba): Rgba {
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: ((foreground.r * foreground.a) + (background.r * background.a * (1 - foreground.a))) / alpha,
        g: ((foreground.g * foreground.a) + (background.g * background.a * (1 - foreground.a))) / alpha,
        b: ((foreground.b * foreground.a) + (background.b * background.a * (1 - foreground.a))) / alpha,
        a: alpha,
      };
    }

    function effectiveBackground(element: Element): Rgba {
      const layers: Rgba[] = [];
      let current: Element | null = element;
      while (current !== null) {
        const style = window.getComputedStyle(current);
        const color = parseCssColor(style.backgroundColor);
        if (color !== null && color.a > 0) {
          layers.push(color);
        }
        const imageColor = parseBackgroundImageColor(style.backgroundImage);
        if (imageColor !== null && imageColor.a > 0) {
          layers.push(imageColor);
        }
        current = current.parentElement;
      }
      return layers.reverse().reduce((background, layer) => blend(layer, background), { r: 9, g: 8, b: 7, a: 1 });
    }

    function linear(channel: number): number {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }

    function luminance(color: Rgba): number {
      return (0.2126 * linear(color.r)) + (0.7152 * linear(color.g)) + (0.0722 * linear(color.b));
    }

    function contrastRatio(foreground: Rgba, background: Rgba): number {
      const fg = luminance(foreground);
      const bg = luminance(background);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    }

    const selector = [
      "button",
      "a",
      "summary",
      "label",
      "legend",
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
      "li",
      "td",
      "th",
      "span",
      "strong",
      "[role='button']",
      "[role='tab']",
    ].join(",");

    return Array.from(document.querySelectorAll(selector))
      .filter((element) => isVisible(element) && !element.closest("[disabled], [aria-disabled='true']"))
      .map((element) => {
        const text = (element.textContent ?? "").replace(/\s+/gu, " ").trim();
        if (text.length < 2) return null;
        const style = window.getComputedStyle(element);
        const foreground = parseCssColor(style.color);
        if (foreground === null || foreground.a === 0) return null;
        const background = effectiveBackground(element);
        const blendedForeground = blend(foreground, background);
        const fontSize = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseInt(style.fontWeight, 10);
        const threshold = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
        const ratio = contrastRatio(blendedForeground, background);
        return {
          selector: selectorFor(element),
          text: text.slice(0, 90),
          ratio: Number(ratio.toFixed(2)),
          threshold,
          fontSize,
          fontWeight: Number.isFinite(fontWeight) ? fontWeight : 400,
        };
      })
      .filter((item): item is ContrastOffender => item !== null && item.ratio + 0.05 < item.threshold)
      .slice(0, 50);
  });
}

export async function collectAccessibilityAudit(page: Page, options: AccessibilityAuditOptions): Promise<AccessibilityAuditResult> {
  const landmarks = await collectLandmarkAudit(page);
  const unnamedControls = await collectUnnamedControls(page);
  const focusIssues = await collectFocusIssues(page, options.maxFocusSteps ?? 18);
  const motionOffenders = await collectMotionOffenders(page);
  const contrastOffenders = await collectContrastOffenders(page);

  return {
    name: options.name,
    path: options.path,
    viewport: options.viewport ?? null,
    landmarks,
    unnamedControls,
    focusIssues,
    motionOffenders,
    contrastOffenders,
    pageErrors: options.problems.pageErrors,
    consoleErrors: options.problems.consoleErrors,
  };
}

export function expectAccessibilityAuditClean(result: AccessibilityAuditResult, requireSingleNamedMain = true): void {
  expect(result.pageErrors, `${result.name}: page errors`).toEqual([]);
  expect(result.consoleErrors, `${result.name}: console errors`).toEqual([]);
  if (requireSingleNamedMain) {
    expect(result.landmarks.mainCount, `${result.name}: visible main landmark count`).toBe(1);
    expect(result.landmarks.mainNames.every((name) => name.length > 0), `${result.name}: main landmark must be named`).toBe(true);
  }
  expect(result.landmarks.unnamedNavCount, `${result.name}: unnamed nav landmarks`).toBe(0);
  expect(result.unnamedControls, `${result.name}: unnamed controls`).toEqual([]);
  expect(result.focusIssues, `${result.name}: focus-visible issues`).toEqual([]);
  expect(result.motionOffenders, `${result.name}: reduced-motion offenders`).toEqual([]);
  expect(result.contrastOffenders, `${result.name}: contrast offenders`).toEqual([]);
}
