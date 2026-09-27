import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Readability in the browser: labels by size and contrast against what is
// really behind them, and a control's boundary against its surround. Shared by
// the Diary and the setup sheet (roadmap N3 and N4).
// ---------------------------------------------------------------------------

/**
 * Every visible label under `scope` smaller than 12 px, or below 4.5:1
 * against the colour actually behind it (3:1 for large text), as
 * "state: tag.class "text" 11px 3.9:1". The background is composited from
 * the element's own and its ancestors' backgrounds, and the text carries
 * its ancestors' opacity; hidden and aria-hidden text is not a label.
 */
export async function unreadableText(page: Page, scope: string, state: string): Promise<string[]> {
  return unreadable(page, scope, state, false);
}

/**
 * The same reading for paper: each label against white, as a printer that
 * leaves backgrounds out puts it. Call it with print media emulated.
 */
export async function unreadableOnPaper(page: Page, scope: string, state: string): Promise<string[]> {
  return unreadable(page, scope, state, true);
}

async function unreadable(page: Page, scope: string, state: string, paper: boolean): Promise<string[]> {
  return page.evaluate(({ scope, state, paper }) => {
    const parse = (value: string): number[] => {
      const parts = (/rgba?\(([^)]+)\)/u.exec(value)?.[1] ?? "0 0 0 0").split(/[ ,/]+/u).filter(Boolean).map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const over = (top: number[], under: number[]): number[] => {
      const alpha = top[3] ?? 1;
      return [0, 1, 2].map((index) => (top[index] ?? 0) * alpha + (under[index] ?? 0) * (1 - alpha)).concat(1);
    };
    const linear = (channel: number): number => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (colour: number[]): number =>
      0.2126 * linear(colour[0] ?? 0) + 0.7152 * linear(colour[1] ?? 0) + 0.0722 * linear(colour[2] ?? 0);
    const behind = (element: Element): number[] => {
      const layers: number[][] = [];
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const background = parse(getComputedStyle(node).backgroundColor);
        if ((background[3] ?? 0) > 0) {
          layers.push(background);
          if ((background[3] ?? 0) >= 1) break;
        }
      }
      return layers.reverse().reduce((under, layer) => over(layer, under), [255, 255, 255, 1]);
    };
    const opacity = (element: Element): number => {
      let product = 1;
      for (let node: Element | null = element; node !== null; node = node.parentElement) product *= Number(getComputedStyle(node).opacity);
      return product;
    };
    const found: string[] = [];
    const seen = new Set<Element>();
    const root = document.querySelector(scope) ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? "").trim();
      const element = node.parentElement;
      if (text.length === 0 || element === null || seen.has(element)) continue;
      seen.add(element);
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || style.visibility === "hidden" || opacity(element) === 0) continue;
      if (element.closest("[aria-hidden='true'], option, select") !== null) continue;
      const background = paper ? [255, 255, 255, 1] : behind(element);
      const ink = parse(style.color);
      const colour = over([ink[0] ?? 0, ink[1] ?? 0, ink[2] ?? 0, (ink[3] ?? 1) * opacity(element)], background);
      const lighter = Math.max(luminance(colour), luminance(background));
      const darker = Math.min(luminance(colour), luminance(background));
      const ratio = (lighter + 0.05) / (darker + 0.05);
      const px = Number.parseFloat(style.fontSize);
      const large = px >= 24 || (px >= 18.66 && Number(style.fontWeight) >= 700);
      if (px < 12 || ratio < (large ? 3 : 4.5)) {
        found.push(`${state}: ${element.tagName.toLowerCase()}.${[...element.classList].join(".")} "${text.slice(0, 40)}" ${String(px)}px ${ratio.toFixed(2)}:1`);
      }
    }
    return found;
  }, { scope, state, paper });
}

/**
 * The contrast of the first `selector` match's border against the colour
 * behind it (the nearest ancestor with a background), as WCAG's non-text
 * contrast asks of a control's boundary.
 */
export async function edgeContrast(page: Page, selector: string): Promise<number> {
  return page.evaluate((selector) => {
    const parse = (value: string): number[] => {
      const parts = (/rgba?\(([^)]+)\)/u.exec(value)?.[1] ?? "0 0 0 0").split(/[ ,/]+/u).filter(Boolean).map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const linear = (channel: number): number => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (colour: number[]): number =>
      0.2126 * linear(colour[0] ?? 0) + 0.7152 * linear(colour[1] ?? 0) + 0.0722 * linear(colour[2] ?? 0);
    const element = document.querySelector(selector);
    if (element === null) return 0;
    let behind = [255, 255, 255, 1];
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      const background = parse(getComputedStyle(node).backgroundColor);
      if ((background[3] ?? 0) > 0) { behind = background; break; }
    }
    const edge = parse(getComputedStyle(element).borderTopColor);
    const [a, b] = [luminance(edge), luminance(behind)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, selector);
}
