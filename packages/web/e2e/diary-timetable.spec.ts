import { expect, test, type Locator } from "@playwright/test";
import {
  GRAND_HALL,
  MACLEOD,
  SALOON,
  VENUE_ID,
  cancels,
  emulate,
  openDiary,
  touch,
} from "./support/diary-timetable.js";

// ---------------------------------------------------------------------------
// E2E: the Diary timetable (T-619) against the emulated API and live hub in
// e2e/support/diary-timetable.ts, with the clock inside the week of Monday
// 14 September 2026.
//
// The phone case drives real touch sequences through CDP. happy-dom has no
// scroll arbitration, so only a browser can show that a finger pans the lane
// and that a long press lifts a block which then survives the finger's
// movement — the defect the lane's review found and the unit tests could not.
// ---------------------------------------------------------------------------

test.describe("Diary timetable", () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opens on this week with the decisions due and the tray, and books where it is clicked", async ({ page }) => {
    const emulated = await emulate(page);
    await openDiary(page);

    // This week, with a quiet venue-wide list of decisions due or overdue —
    // a hold next March whose decision was due yesterday included.
    await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
    const decisions = page.getByRole("region", { name: /Decisions due/u });
    await expect(decisions.getByRole("heading", { name: /Overdue/u })).toBeVisible();
    await expect(decisions.getByRole("button", { name: /Hartley wedding/u })).toContainText("2nd option · Fiona Coordinator");
    await expect(decisions.getByRole("button", { name: /Guild dinner/u })).toContainText("Joint 1st · No owner");

    // The tray: the open enquiries, newest first, read once.
    await expect(page.locator(".diary-tray-enquiry .diary-tray-item-title")).toHaveText(["Aisha and Tom Baird", "Glasgow Law Society"]);
    expect(emulated.enquiryRequests).toEqual([`?states=submitted%2Cunder_review&order=created_desc&venueId=${VENUE_ID}&limit=51`]);

    // An empty square of the overview makes a booking on its room and day.
    // Browsers' ICU data differs on the comma after the weekday.
    await page.getByRole("button", { name: /^New booking — Saloon, Wed,? 16 Sept?$/u }).click();
    const create = page.getByRole("dialog", { name: "New booking" });
    await expect(create.getByLabel("Room")).toHaveValue(SALOON);
    await expect(create.getByLabel("Starts", { exact: true })).toHaveValue("2026-09-16T17:00");
    // Every field fits the drawer: nothing runs past its edge to make it
    // scroll sideways.
    expect(await create.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await create.getByRole("button", { name: "Close" }).click();

    // On the timeline, a click on empty lane space books at that time:
    // Tuesday 10:00 is 34 hours in, at 18 px an hour (+1 px stays inside
    // the quarter hour the click snaps to).
    await page.getByRole("button", { name: "Timeline" }).click();
    const lane = page.locator(`[data-diary-lane="${GRAND_HALL}"]`);
    const box = await lane.boundingBox();
    if (box === null) throw new Error("expected the Grand Hall lane on screen");
    await page.mouse.click(box.x + 34 * 18 + 1, box.y + 8);
    await expect(create.getByLabel("Room")).toHaveValue(GRAND_HALL);
    await expect(create.getByLabel("Starts", { exact: true })).toHaveValue("2026-09-15T10:00");
    await create.getByRole("button", { name: "Close" }).click();

    // The drawer states owner and client, keeps the note, and saves an edit
    // of it; the board move that follows does not re-read the tray.
    await page.getByRole("button", { name: /^MacLeod wedding — /u }).click();
    const details = page.getByRole("dialog", { name: "Booking details" });
    const summary = details.getByRole("region", { name: "Booking summary" });
    await expect(summary).toContainText("Elaine Gray");
    await expect(summary).toContainText("Fiona and Ross MacLeod");
    await expect(details.getByLabel("Room")).toBeEnabled();
    await expect(details.getByLabel("Notes")).toHaveValue("Ceremony in the Saloon, dinner in the Grand Hall.");
    await details.getByLabel("Notes").fill("Ceremony in the Saloon at 14:00, dinner in the Grand Hall.");
    await details.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved MacLeod wedding.")).toBeVisible();
    expect(emulated.updates).toEqual([{ bookingId: MACLEOD, payload: { notes: "Ceremony in the Saloon at 14:00, dinner in the Grand Hall." } }]);
    await page.getByRole("button", { name: "Later" }).click();
    await expect(page.getByText(/^Week of /u)).toBeVisible();
    // Once at load, once after the save; not for the move to next week.
    expect(emulated.enquiryRequests).toHaveLength(2);
  });

});

test.describe("Diary timetable on a phone", () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  test("a finger pans the lane, and a long press lifts a block that follows the finger", async ({ page }) => {
    const emulated = await emulate(page);
    await openDiary(page, "/diary?view=day&date=2026-09-19");
    const scroller = page.locator(".diary-scroll");
    const block = page.getByRole("button", { name: /^MacLeod wedding — /u });
    // Bring the block's start to the left edge of the lane, beside the rail.
    await block.evaluate((element) => {
      const lane = element.closest<HTMLElement>(".diary-scroll");
      if (lane !== null && element instanceof HTMLElement) lane.scrollLeft = element.offsetLeft;
    });
    await page.evaluate(() => {
      const counts = { cancel: 0 };
      window.__diaryPointerCounts = counts;
      document.addEventListener("pointercancel", () => { counts.cancel += 1; }, true);
    });
    const cdp = await page.context().newCDPSession(page);
    // A point on the part of the block a finger can actually see: inside the
    // lane's visible area, clear of the sticky room rail.
    const pointOn = async (target: Locator): Promise<{ x: number; y: number }> => target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const lane = element.closest(".diary-scroll")?.getBoundingClientRect();
      const rail = element.closest(".diary-lane-row")?.querySelector(".diary-rail")?.getBoundingClientRect();
      if (lane === undefined || rail === undefined) throw new Error("expected the lane and its rail");
      const left = Math.max(rect.left, rail.right);
      const right = Math.min(rect.right, lane.right);
      if (right - left < 60) throw new Error("the block is not visible enough to touch");
      return { x: left + 30, y: rect.top + rect.height / 2 };
    });

    // A swipe that starts on the block pans the lane and lifts nothing.
    const before = await scroller.evaluate((element) => element.scrollLeft);
    const swipeFrom = await pointOn(block);
    await touch(cdp, "touchStart", swipeFrom);
    for (let step = 1; step <= 8; step += 1) {
      await touch(cdp, "touchMove", { x: swipeFrom.x - step * 20, y: swipeFrom.y });
    }
    await touch(cdp, "touchEnd", null);
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before + 60);
    await expect(page.locator(".diary-ghost")).toHaveCount(0);
    expect(emulated.updates).toHaveLength(0);
    // Taking the pan, the browser cancelled the press — as it should.
    expect(await cancels(page)).toBe(1);
    await page.evaluate(() => { if (window.__diaryPointerCounts !== undefined) window.__diaryPointerCounts.cancel = 0; });

    // The swipe can leave the lane gliding: Chromium 147 flings an emulated
    // swipe as it would a finger's. A touch that lands on a glide only stops
    // it — the browser keeps that touch, so the board lifts nothing from it
    // (lib/touch-scroll.ts) — and a deliberate press starts from a lane at
    // rest. Wait for the lane to stand still before pressing.
    await expect.poll(async () => {
      const first = await scroller.evaluate((element) => element.scrollLeft);
      await page.waitForTimeout(100);
      return (await scroller.evaluate((element) => element.scrollLeft)) === first;
    }).toBe(true);

    // A long press lifts it; the finger then carries it an hour later (96 px
    // an hour on the day view) without the browser taking the gesture back.
    // Its start stays scrolled out of view, as on a phone it usually is.
    await block.evaluate((element) => {
      const lane = element.closest<HTMLElement>(".diary-scroll");
      if (lane !== null && element instanceof HTMLElement) lane.scrollLeft = element.offsetLeft + 200;
    });
    const pressAt = await pointOn(block);
    await touch(cdp, "touchStart", pressAt);
    await page.waitForTimeout(650);
    await expect(page.locator(".diary-block.is-lifted")).toHaveCount(1);
    for (let step = 1; step <= 8; step += 1) {
      await touch(cdp, "touchMove", { x: pressAt.x + step * 12, y: pressAt.y });
    }
    await expect(page.locator(".diary-ghost")).toHaveCount(1);
    // The ghost passes under the room rail, and its time stays readable
    // beside the rail rather than off-screen with the ghost's start.
    const ghost = await page.locator(".diary-ghost-time").evaluate((element) => {
      const ghostBox = element.closest(".diary-ghost");
      const rail = element.closest(".diary-lane-row")?.querySelector(".diary-rail");
      if (ghostBox === null || rail === null || rail === undefined) throw new Error("expected the ghost and its rail");
      return {
        text: element.textContent,
        besideRail: element.getBoundingClientRect().left - rail.getBoundingClientRect().right,
        ghostStartHidden: ghostBox.getBoundingClientRect().left < rail.getBoundingClientRect().right,
        underRail: Number(getComputedStyle(ghostBox).zIndex) < Number(getComputedStyle(rail).zIndex),
      };
    });
    expect(ghost).toMatchObject({ text: "15:00–00:30", ghostStartHidden: true, underRail: true });
    expect(ghost.besideRail).toBeGreaterThanOrEqual(0);
    expect(ghost.besideRail).toBeLessThan(20);
    await touch(cdp, "touchEnd", null);
    await expect.poll(() => emulated.updates.length).toBe(1);
    expect(emulated.updates[0]).toEqual({
      bookingId: MACLEOD,
      payload: { spaceId: GRAND_HALL, startsAt: "2026-09-19T14:00:00.000Z", endsAt: "2026-09-19T23:30:00.000Z" },
    });
    // The lifted block kept the finger: the browser never took it back.
    expect(await cancels(page)).toBe(0);
  });
});
