import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readPushAlertsState, registerPushWorker, subscribeThisDevice, unsubscribeThisDevice,
  type PushBrowser, type PushRegistrationLike, type PushSubscriptionLike,
} from "../push-alerts.js";

const mocks = vi.hoisted(() => ({
  getVapidPublicKey: vi.fn(),
  savePushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
}));

vi.mock("../../api/push.js", () => ({
  getVapidPublicKey: mocks.getVapidPublicKey,
  savePushSubscription: mocks.savePushSubscription,
  removePushSubscription: mocks.removePushSubscription,
}));

const VENUE = "00000000-0000-4000-8000-000000008001";
// A VAPID public key is url-safe base64 of 65 bytes; this one is synthetic.
const PUBLIC_KEY = "BA".padEnd(87, "A");
const ENDPOINT = "https://push.example.test/dev-1";

function subscriptionFixture(unsubscribe: () => Promise<boolean> = () => Promise.resolve(true)): PushSubscriptionLike {
  return { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }), unsubscribe };
}

function fakeBrowser(options: {
  readonly supported?: boolean;
  readonly permission?: NotificationPermission;
  readonly askAnswer?: NotificationPermission;
  readonly existing?: PushSubscriptionLike | null;
}): { readonly browser: PushBrowser; readonly subscribe: ReturnType<typeof vi.fn>; readonly register: ReturnType<typeof vi.fn> } {
  const subscribe = vi.fn().mockResolvedValue(subscriptionFixture());
  const register = vi.fn().mockResolvedValue(undefined);
  const registration: PushRegistrationLike = {
    pushManager: {
      getSubscription: () => Promise.resolve(options.existing ?? null),
      subscribe: (init: PushSubscriptionOptionsInit) => subscribe(init) as Promise<PushSubscriptionLike>,
    },
  };
  const browser: PushBrowser = {
    serviceWorker: options.supported === false ? undefined : {
      register: (path: string) => register(path) as Promise<unknown>,
      ready: Promise.resolve(registration),
    },
    pushSupported: options.supported !== false,
    permission: () => options.permission ?? "default",
    requestPermission: () => Promise.resolve(options.askAnswer ?? "granted"),
    userAgent: "Test/1.0",
  };
  return { browser, subscribe, register };
}

beforeEach(() => {
  mocks.getVapidPublicKey.mockReset();
  mocks.savePushSubscription.mockReset();
  mocks.removePushSubscription.mockReset();
  mocks.getVapidPublicKey.mockResolvedValue(PUBLIC_KEY);
  mocks.savePushSubscription.mockResolvedValue({ id: "s-1", deviceKind: "phone", createdAt: "2026-10-17T10:00:00.000Z" });
  mocks.removePushSubscription.mockResolvedValue(undefined);
});

describe("alerts on this device", () => {
  it("reads unsupported, denied, off and on without asking the person anything", async () => {
    expect(await readPushAlertsState(fakeBrowser({ supported: false }).browser)).toBe("unsupported");
    expect(await readPushAlertsState(fakeBrowser({ permission: "denied" }).browser)).toBe("denied");
    expect(await readPushAlertsState(fakeBrowser({}).browser)).toBe("off");
    expect(await readPushAlertsState(fakeBrowser({ existing: subscriptionFixture() }).browser)).toBe("on");
  });

  it("turns on: asks the browser, subscribes with the server's key and saves the device, as a phone", async () => {
    const { browser, subscribe } = fakeBrowser({});
    expect(await subscribeThisDevice(VENUE, "phone", browser)).toBe("on");
    expect(subscribe).toHaveBeenCalledTimes(1);
    const call = subscribe.mock.calls[0]?.[0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(call.userVisibleOnly).toBe(true);
    expect(call.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(call.applicationServerKey.length).toBe(65);
    expect(mocks.savePushSubscription).toHaveBeenCalledWith({
      venueId: VENUE, endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" }, deviceKind: "phone", userAgent: "Test/1.0",
    });
  });

  it("says off-server when the server has no key, and asks the browser for nothing", async () => {
    mocks.getVapidPublicKey.mockResolvedValue(null);
    const { browser, subscribe } = fakeBrowser({});
    expect(await subscribeThisDevice(VENUE, "desk", browser)).toBe("off-server");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("says denied when the person refuses, and saves nothing", async () => {
    const { browser } = fakeBrowser({ askAnswer: "denied" });
    expect(await subscribeThisDevice(VENUE, "desk", browser)).toBe("denied");
    expect(mocks.savePushSubscription).not.toHaveBeenCalled();
  });

  it("turns off: the server forgets the device before the browser does", async () => {
    const order: string[] = [];
    mocks.removePushSubscription.mockImplementation(() => { order.push("server"); return Promise.resolve(); });
    const existing = subscriptionFixture(() => { order.push("browser"); return Promise.resolve(true); });
    expect(await unsubscribeThisDevice(fakeBrowser({ existing }).browser)).toBe("off");
    expect(order).toEqual(["server", "browser"]);
    expect(mocks.removePushSubscription).toHaveBeenCalledWith(ENDPOINT);
  });

  it("registers the worker where push exists and nowhere else", () => {
    const supported = fakeBrowser({});
    registerPushWorker(supported.browser);
    expect(supported.register).toHaveBeenCalledWith("/sw.js");
    const unsupported = fakeBrowser({ supported: false });
    registerPushWorker(unsupported.browser);
    expect(unsupported.register).not.toHaveBeenCalled();
  });
});
