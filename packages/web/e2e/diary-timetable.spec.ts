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
  unreadableText,
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

  test("keeps its rooms while a week is on its way, and its bookings when a refresh fails", async ({ page }) => {
    const emulated = await emulate(page);
    // Monday 21 September, 00:00 BST: next week's read waits until released.
    const nextWeek = "2026-09-20T23:00:00.000Z";
    let releaseNextWeek: () => void = () => undefined;
    emulated.calendarPlan.set(nextWeek, new Promise<void>((resolve) => { releaseNextWeek = resolve; }));
    await openDiary(page);
    const hammermen = page.getByRole("button", { name: /^Hammermen annual dinner — /u });
    await expect(hammermen).toBeVisible();
    const boardTop = async (): Promise<number> => (await page.locator(".diary-layout").boundingBox())?.y ?? Number.NaN;
    const settledTop = await boardTop();

    // A week on its way keeps the rooms, its own days and the decisions due,
    // and claims nothing about bookings it has not read.
    await page.getByRole("button", { name: "Later" }).click();
    await expect(page.getByText(/^Opening the week of Mon,? 21 Sept? 2026…$/u)).toBeVisible();
    await expect(page.locator(".diary-overview-room h2")).toHaveText(["Grand Hall", "Saloon", "Robert Adam Room"]);
    await expect(page.getByRole("region", { name: "Booking overview" })).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("region", { name: /Decisions due/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /^New booking — /u })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Conflicts" })).toHaveCount(0);
    await expect(page.getByText("Opening the diary…")).toHaveCount(0);
    expect(await boardTop()).toBe(settledTop);

    releaseNextWeek();
    await expect(page.getByText("No bookings in this range.")).toBeVisible();
    await expect(page.getByText(/^Opening the week of/u)).toHaveCount(0);

    // This week was read a moment ago, so it opens at once.
    await page.getByRole("button", { name: "Earlier" }).click();
    await expect(hammermen).toBeVisible();
    await expect(page.getByText(/^Opening the week of/u)).toHaveCount(0);

    // A refresh that fails keeps the bookings and says so beside the legend.
    emulated.calendarPlan.set("2026-09-13T23:00:00.000Z", "fail");
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Couldn't refresh at 09:00.")).toBeVisible();
    await expect(hammermen).toBeVisible();
    await expect(page.getByText("The diary could not load.")).toHaveCount(0);
    expect(await boardTop()).toBe(settledTop);

    emulated.calendarPlan.clear();
    await page.locator(".diary-status-notice").getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText(/^Couldn't refresh/u)).toHaveCount(0);
    await expect(hammermen).toBeVisible();
  });

  test("every label on the board reads at 12 px or more and 4.5:1 or better", async ({ page }) => {
    // Reduced motion: no colour transition is caught half-way.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await emulate(page);
    await openDiary(page);
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByLabel("Show released & cancelled").check();
    const found = await unreadableText(page, ".diary-view-menu", "view menu");
    await page.keyboard.press("Escape");
    found.push(...await unreadableText(page, ".diary-page", "overview"));
    await page.getByRole("button", { name: "Timeline" }).click();
    await expect(page.locator(".diary-lane").first()).toBeVisible();
    found.push(...await unreadableText(page, ".diary-page", "timeline"));
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expect(page.locator(".diary-lane").first()).toBeVisible();
    found.push(...await unreadableText(page, ".diary-page", "day"));
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await page.getByRole("button", { name: "Overview" }).click();
    await page.getByRole("button", { name: /^Hammermen annual dinner — /u }).click();
    const drawer = page.getByRole("dialog", { name: "Booking details" });
    await drawer.getByRole("button", { name: "Cancel the booking…", exact: true }).click();
    await expect(drawer.getByRole("group", { name: /^Cancel .*\?$/u })).toBeVisible();
    found.push(...await unreadableText(page, ".diary-drawer", "drawer"));
    expect(found).toEqual([]);
  });

  test("goes to a date as it was said, and answers what each room holds", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await emulate(page);
    await openDiary(page);
    await page.keyboard.press("g");
    const field = page.getByRole("textbox", { name: "Go to date" });
    await expect(field).toBeFocused();
    await field.fill("5 Jun 27");
    await field.press("Enter");
    // The week of Saturday 5 June 2027, with the day marked and each room answered.
    // Browsers' ICU data differs on the comma after the weekday.
    await expect(page.getByText(/^Week of Mon,? 31 May 2027$/u)).toBeVisible();
    await expect(page.locator(".diary-overview-day.is-sought")).toContainText(/Sat,? 5 Jun/u);
    const answer = page.locator(".diary-goto-answer");
    await expect(answer.locator(".diary-goto-day")).toHaveText(/^Sat,? 5 Jun 2027$/u);
    await expect(answer.locator("dt")).toHaveText(["Grand Hall", "Saloon", "Robert Adam Room"]);
    await expect(answer.locator("dd")).toHaveText(["Free", "Free", "Free"]);

    // A day the board holds bookings on names them in Blake's words, and a
    // weekday said with the date that is not its own is pointed out.
    await field.fill("Fri 19/09/2026");
    await field.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("That date is a Saturday, not a Friday.");
    await expect(answer.locator(".diary-goto-day")).toHaveText(/^Sat,? 19 Sept? 2026$/u);
    await expect(answer.locator("dd")).toHaveText([/^1st option MacLeod wedding, 14:00–23:30, decides Mon,? 21 Sept?$/u, "Free", "Free"]);
    expect(await unreadableText(page, ".diary-goto", "go to date")).toEqual([]);

    await field.press("Escape");
    await expect(page.getByRole("button", { name: "Go to date" })).toBeFocused();
  });

  test("opens on this week with the decisions due and the tray, and books where it is clicked", async ({ page }) => {
    const emulated = await emulate(page);
    await openDiary(page);

    // New booking keeps its place beside the title, and the toolbar keeps
    // one row at a desktop's width (roadmap N3's reduced toolbar).
    await expect(page.locator(".diary-heading").getByRole("button", { name: "New booking", exact: true })).toBeVisible();
    const toolbarRows = await page.locator(".diary-controls .diary-button:visible")
      .evaluateAll((buttons) => new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size);
    expect(toolbarRows).toBe(1);

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

    // A gap's time opens its changeover sheet (T-637): between Thursday's
    // Hammermen dinner and Saturday's MacLeod wedding, which is provisional,
    // so the gap waits to be checked against the room's time.
    await page.getByRole("button", { name: "Changeover in Grand Hall: 39 hours between Hammermen annual dinner and MacLeod wedding" }).click();
    const changeover = page.getByRole("dialog", { name: "Changeover" });
    const needs = changeover.getByRole("region", { name: "The time this room needs" });
    await expect(needs.getByText("2 h", { exact: true })).toBeVisible();
    await expect(needs.getByText("Not confirmed")).toBeVisible();
    await expect(needs.getByText("Checked once both functions are confirmed")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(changeover).toBeHidden();

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
