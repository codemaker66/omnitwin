import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Loadout, LoadoutDetail as LoadoutDetailData, LoadoutPhoto } from "../../../api/loadouts.js";
import type { Space } from "../../../api/spaces.js";
import { LoadoutDetail } from "../LoadoutDetail.js";
import { LoadoutsView } from "../LoadoutsView.js";

const VENUE_ID = "00000000-0000-4000-8000-000000008001";
const SPACE_ID = "00000000-0000-4000-8000-000000008002";
const LOADOUT_ID = "00000000-0000-4000-8000-000000008003";
const PHOTO_ID = "00000000-0000-4000-8000-000000008004";
const NOW = "2026-06-19T11:00:00.000Z";

const { authState, mocks } = vi.hoisted(() => ({
  authState: {
    user: {
      id: "00000000-0000-4000-8000-000000008010",
      email: "ops@tradeshall.test",
      role: "staff",
      platformRole: "none",
      venueId: "00000000-0000-4000-8000-000000008001",
      name: "Ops",
    } as {
      readonly id: string;
      readonly email: string;
      readonly role: string;
      readonly platformRole: "none" | "operator" | "admin";
      readonly venueId: string | null;
      readonly name: string;
    } | null,
  },
  mocks: {
    addPhoto: vi.fn(),
    createLoadout: vi.fn(),
    deleteLoadout: vi.fn(),
    deletePhoto: vi.fn(),
    getLoadout: vi.fn(),
    listLoadouts: vi.fn(),
    reorderPhotos: vi.fn(),
    updateLoadout: vi.fn(),
    updatePhoto: vi.fn(),
    listSpaces: vi.fn(),
    addToast: vi.fn(),
  },
}));

vi.mock("../../../api/loadouts.js", () => ({
  addPhoto: mocks.addPhoto,
  createLoadout: mocks.createLoadout,
  deleteLoadout: mocks.deleteLoadout,
  deletePhoto: mocks.deletePhoto,
  getLoadout: mocks.getLoadout,
  listLoadouts: mocks.listLoadouts,
  reorderPhotos: mocks.reorderPhotos,
  updateLoadout: mocks.updateLoadout,
  updatePhoto: mocks.updatePhoto,
}));

vi.mock("../../../api/spaces.js", () => ({
  listSpaces: mocks.listSpaces,
}));

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown): unknown => selector(authState),
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (selector: (state: { readonly addToast: typeof mocks.addToast }) => unknown): unknown =>
    selector({ addToast: mocks.addToast }),
}));

vi.mock("../../shared/FileUploader.js", () => ({
  FileUploader: (props: { readonly onUploaded: (fileId: string, filename: string) => void }) => (
    <button
      type="button"
      onClick={() => { props.onUploaded("00000000-0000-4000-8000-000000008099", "uploaded.jpg"); }}
    >
      Mock upload
    </button>
  ),
}));

function spaceFixture(overrides: Partial<Space> = {}): Space {
  return {
    id: SPACE_ID,
    venueId: VENUE_ID,
    name: "Reception Room",
    slug: "reception-room",
    widthM: "12",
    lengthM: "8",
    heightM: "4",
    floorPlanOutline: [],
    loadoutCount: 1,
    ...overrides,
  };
}

function loadoutFixture(overrides: Partial<Loadout> = {}): Loadout {
  return {
    id: LOADOUT_ID,
    name: "Dinner reset reference",
    description: "Reference pack",
    createdAt: NOW,
    photoCount: 1,
    coverFileKey: null,
    ...overrides,
  };
}

function photoFixture(overrides: Partial<LoadoutPhoto> = {}): LoadoutPhoto {
  return {
    id: PHOTO_ID,
    fileId: "00000000-0000-4000-8000-000000008005",
    caption: "Main entrance",
    sortOrder: 0,
    fileKey: "loadouts/main.jpg",
    filename: "main.jpg",
    contentType: "image/jpeg",
    ...overrides,
  };
}

function detailFixture(overrides: Partial<LoadoutDetailData> = {}): LoadoutDetailData {
  return {
    id: LOADOUT_ID,
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    name: "Dinner reset reference",
    description: "Reference pack",
    createdAt: NOW,
    updatedAt: NOW,
    photos: [photoFixture()],
    ...overrides,
  };
}

beforeEach(() => {
  authState.user = {
    id: "00000000-0000-4000-8000-000000008010",
    email: "ops@tradeshall.test",
    role: "staff",
    platformRole: "none",
    venueId: VENUE_ID,
    name: "Ops",
  };

  mocks.addPhoto.mockReset();
  mocks.createLoadout.mockReset();
  mocks.deleteLoadout.mockReset();
  mocks.deletePhoto.mockReset();
  mocks.getLoadout.mockReset();
  mocks.listLoadouts.mockReset();
  mocks.reorderPhotos.mockReset();
  mocks.updateLoadout.mockReset();
  mocks.updatePhoto.mockReset();
  mocks.listSpaces.mockReset();
  mocks.addToast.mockReset();

  mocks.listSpaces.mockResolvedValue([spaceFixture()]);
  mocks.listLoadouts.mockResolvedValue([loadoutFixture()]);
  mocks.createLoadout.mockResolvedValue(detailFixture());
  mocks.getLoadout.mockResolvedValue(detailFixture());
  mocks.updateLoadout.mockResolvedValue(detailFixture({ name: "Updated setup" }));
  mocks.updatePhoto.mockResolvedValue(photoFixture({ caption: "Updated caption" }));
  mocks.deletePhoto.mockResolvedValue(undefined);
  mocks.deleteLoadout.mockResolvedValue(undefined);
  mocks.addPhoto.mockResolvedValue(photoFixture({ filename: "uploaded.jpg" }));
  mocks.reorderPhotos.mockResolvedValue([photoFixture()]);
});

afterEach(() => {
  cleanup();
});

describe("LoadoutsView", () => {
  it("shows a no-venue state instead of spinning forever", () => {
    authState.user = {
      id: "00000000-0000-4000-8000-000000008010",
      email: "ops@tradeshall.test",
      role: "staff",
      platformRole: "none",
      venueId: null,
      name: "Ops",
    };

    render(<LoadoutsView />);

    expect(screen.getByText("No venue assigned")).toBeTruthy();
    expect(mocks.listSpaces).not.toHaveBeenCalled();
  });

  it("surfaces room-list failures with a retry path", async () => {
    mocks.listSpaces
      .mockRejectedValueOnce(new Error("spaces offline"))
      .mockResolvedValueOnce([spaceFixture()]);

    render(<LoadoutsView />);

    const error = await screen.findByTestId("loadout-spaces-error");
    expect(error.textContent).toContain("spaces offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry rooms" }));

    expect(await screen.findByRole("button", { name: "Reception Room" })).toBeTruthy();
    expect(mocks.listSpaces).toHaveBeenCalledTimes(2);
  });

  it("surfaces loadout-list failures with a retry path", async () => {
    mocks.listLoadouts
      .mockRejectedValueOnce(new Error("loadouts offline"))
      .mockResolvedValueOnce([loadoutFixture()]);

    render(<LoadoutsView />);

    const error = await screen.findByTestId("loadouts-list-error");
    expect(error.textContent).toContain("loadouts offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry loadouts" }));

    expect(await screen.findByRole("button", { name: "Open reference loadout Dinner reset reference" })).toBeTruthy();
  });

  it("keeps create-loadout failures inside the modal", async () => {
    mocks.createLoadout.mockRejectedValueOnce(new Error("create rejected"));

    render(<LoadoutsView />);

    fireEvent.click(await screen.findByRole("button", { name: "New Loadout" }));
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Wedding reset" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const error = await screen.findByTestId("loadout-create-error");
    expect(error.textContent).toContain("create rejected");
    expect(screen.getByRole("dialog", { name: "New Reference Loadout" })).toBeTruthy();
  });
});

describe("LoadoutDetail", () => {
  it("surfaces loadout-detail failures with retry", async () => {
    mocks.getLoadout
      .mockRejectedValueOnce(new Error("detail unavailable"))
      .mockResolvedValueOnce(detailFixture());

    render(
      <LoadoutDetail
        venueId={VENUE_ID}
        spaceId={SPACE_ID}
        loadoutId={LOADOUT_ID}
        onBack={() => undefined}
        onDeleted={() => undefined}
      />,
    );

    const error = await screen.findByTestId("loadout-detail-error");
    expect(error.textContent).toContain("detail unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { name: "Dinner reset reference" })).toBeTruthy();
  });

  it("keeps failed detail mutations visible", async () => {
    mocks.updatePhoto.mockRejectedValueOnce(new Error("caption write rejected"));

    render(
      <LoadoutDetail
        venueId={VENUE_ID}
        spaceId={SPACE_ID}
        loadoutId={LOADOUT_ID}
        onBack={() => undefined}
        onDeleted={() => undefined}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Main entrance" }));
    fireEvent.change(screen.getByLabelText("Caption for main.jpg"), { target: { value: "Keep main route clear" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.updatePhoto).toHaveBeenCalledWith(LOADOUT_ID, PHOTO_ID, { caption: "Keep main route clear" });
    });
    const error = screen.getByTestId("loadout-action-error");
    expect(error.textContent).toContain("caption write rejected");
  });
});
