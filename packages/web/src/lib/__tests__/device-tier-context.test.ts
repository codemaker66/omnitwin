import { describe, expect, it } from "vitest";
import { classifyDeviceInContext, deviceFormFactor } from "../device-tier.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const MAC_OR_IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("device classification with form factor (T-639)", () => {
  it("does not treat an iPhone's 'Apple GPU' as a desktop card", () => {
    expect(classifyDeviceInContext("Apple GPU", { userAgent: IPHONE, maxTouchPoints: 5 })).toBe("low");
  });

  it("caps an iPad (desktop-mode Safari with touch) at medium", () => {
    expect(classifyDeviceInContext("Apple GPU", { userAgent: MAC_OR_IPAD, maxTouchPoints: 5 })).toBe("medium");
  });

  it("keeps an Apple-silicon Mac at high", () => {
    expect(classifyDeviceInContext("Apple GPU", { userAgent: MAC_OR_IPAD, maxTouchPoints: 0 })).toBe("high");
  });

  it("caps a flagship Android phone at low", () => {
    expect(classifyDeviceInContext("Adreno (TM) 750", { userAgent: ANDROID_PHONE, maxTouchPoints: 5 })).toBe("low");
  });

  it("caps an Android tablet at medium, like an iPad", () => {
    expect(classifyDeviceInContext("Adreno (TM) 750", { userAgent: ANDROID_TABLET, maxTouchPoints: 5 })).toBe("medium");
  });

  it("never raises a device above its GPU tier", () => {
    expect(classifyDeviceInContext("Mali-T880", { userAgent: IPHONE, maxTouchPoints: 5 })).toBe("low");
    expect(classifyDeviceInContext("SwiftShader", { userAgent: ANDROID_PHONE, maxTouchPoints: 5 })).toBe("poster");
  });

  it("reads the form factor from the user agent and touch support alone", () => {
    expect(deviceFormFactor({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe("phone");
    expect(deviceFormFactor({ userAgent: ANDROID_PHONE, maxTouchPoints: 5 })).toBe("phone");
    expect(deviceFormFactor({ userAgent: MAC_OR_IPAD, maxTouchPoints: 5 })).toBe("tablet");
    expect(deviceFormFactor({ userAgent: ANDROID_TABLET, maxTouchPoints: 5 })).toBe("tablet");
    expect(deviceFormFactor({ userAgent: MAC_OR_IPAD, maxTouchPoints: 0 })).toBe("desktop");
    expect(deviceFormFactor({ userAgent: "", maxTouchPoints: 0 })).toBe("desktop");
  });
});
