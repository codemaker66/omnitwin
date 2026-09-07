import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:3001";
const VENUE_ID = "10000000-0000-4000-8000-000000009001";
const SPACE_ID = "10000000-0000-4000-8000-000000009002";
const CONFIG_ID = "10000000-0000-4000-8000-000000009003";
const venue = {
  id: VENUE_ID, name: "Guest entry test venue", slug: "guest-entry-fixture",
  address: "Synthetic browser fixture", logoUrl: null, brandColour: null,
};
const space = {
  id: SPACE_ID, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall",
  widthM: "6", lengthM: "5", heightM: "3",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 0, y: 5 }],
};
const configuration = {
  id: CONFIG_ID, venueId: VENUE_ID, spaceId: SPACE_ID, userId: null,
  name: "Synthetic guest draft", isPublicPreview: true, revision: 1, objects: [],
};

async function mockGuestDraft(page: Page): Promise<readonly string[]> {
  const createdSpaces: string[] = [];
  await page.route(`${API}/**`, (route) => route.abort());
  await page.route(`${API}/venues`, (route) => route.fulfill({ json: { data: [venue] } }));
  await page.route(`${API}/venues/${VENUE_ID}`, (route) => route.fulfill({ json: { data: { ...venue, spaces: [space] } } }));
  await page.route(`${API}/venues/${VENUE_ID}/spaces`, (route) => route.fulfill({ json: { data: [space] } }));
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => route.fulfill({ json: { data: space } }));
  await page.route(`${API}/public/configurations`, async (route) => {
    expect(route.request().method()).toBe("POST");
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({ spaceId: SPACE_ID });
    createdSpaces.push(SPACE_ID);
    await route.fulfill({ status: 201, json: { data: configuration } });
  });
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => route.fulfill({ json: { data: configuration } }));
  await page.route(`${API}/assets/runtime-packages/latest**`, (route) => route.fulfill({ json: { data: null } }));
  return createdSpaces;
}

for (const path of ["/plan", "/v/guest-entry-fixture/plan?space=grand-hall"] as const) {
  test(`an unseeded guest opens a saved draft from ${path}`, async ({ page }) => {
    const clerkRequests: string[] = [];
    page.on("request", (request) => {
      if (/clerk\.(?:accounts|com)|clerk\.browser|clerk-js/i.test(request.url())) clerkRequests.push(request.url());
    });
    const createdSpaces = await mockGuestDraft(page);
    await page.goto(path);
    await expect(page).toHaveURL((url) => url.pathname === `/plan/${CONFIG_ID}`, { timeout: 15_000 });
    await expect(page.getByTestId("cockpit-shell")).toBeVisible();
    expect(createdSpaces).toEqual([SPACE_ID]);
    expect(new URL(page.url()).searchParams.get("space")).toBe(path.includes("?") ? "grand-hall" : null);
    expect(clerkRequests).toEqual([]);
    expect(await page.evaluate(() => "__OMNITWIN_E2E__" in window)).toBe(false);
  });
}
