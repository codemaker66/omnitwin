import { describe, it, expect, beforeEach } from "vitest";
import { useChairDialogStore } from "../chair-dialog-store.js";

const MOCK_REQUEST = {
  catalogueItemId: "round-table-5ft",
  x: 1,
  z: 2,
  rotationY: 0,
  tableShape: "round" as const,
};

beforeEach(() => {
  useChairDialogStore.getState().clearDialog();
});

describe("chair-dialog-store", () => {
  it("starts with no pending request", () => {
    expect(useChairDialogStore.getState().pending).toBeNull();
    expect(useChairDialogStore.getState().editTableId).toBeNull();
  });

  it("showDialog sets pending request", () => {
    useChairDialogStore.getState().showDialog(MOCK_REQUEST);
    expect(useChairDialogStore.getState().pending).toEqual(MOCK_REQUEST);
    expect(useChairDialogStore.getState().editTableId).toBeNull();
  });

  it("showDialog with editTableId sets both", () => {
    useChairDialogStore.getState().showDialog(MOCK_REQUEST, "table-123");
    expect(useChairDialogStore.getState().pending).toEqual(MOCK_REQUEST);
    expect(useChairDialogStore.getState().editTableId).toBe("table-123");
  });

  it("clearDialog resets both pending and editTableId", () => {
    useChairDialogStore.getState().showDialog(MOCK_REQUEST, "table-123");
    useChairDialogStore.getState().clearDialog();
    expect(useChairDialogStore.getState().pending).toBeNull();
    expect(useChairDialogStore.getState().editTableId).toBeNull();
  });

  it("showDialog without editTableId defaults to null (not undefined)", () => {
    useChairDialogStore.getState().showDialog(MOCK_REQUEST);
    expect(useChairDialogStore.getState().editTableId).toBeNull();
  });
});
