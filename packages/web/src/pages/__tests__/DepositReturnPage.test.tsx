import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { DepositReturnPage } from "../DepositReturnPage.js";
import { keepDepositReturnToken } from "../../components/proposal/deposit-return.js";

// ---------------------------------------------------------------------------
// Back from Stripe (Plan 19 L5): Stripe is given /deposit-return, never the
// client's share token. The tab that left kept the token and returns to the
// proposal once; without it, the page says where to look.
// ---------------------------------------------------------------------------

const TOKEN = "clientDepositToken_0123456789abcdefghijklmnopqrstuv";

function Where(): React.ReactElement {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}{location.search}</p>;
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/deposit-return" element={<DepositReturnPage />} />
        <Route path="/proposal-share/:token" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { cleanup(); window.sessionStorage.clear(); });

describe("back from Stripe", () => {
  it("returns to the proposal the tab left from, saying how, and forgets the token", async () => {
    keepDepositReturnToken(TOKEN);
    renderAt("/deposit-return?outcome=returned");
    expect((await screen.findByTestId("where")).textContent).toBe(`/proposal-share/${TOKEN}?deposit=returned`);
    expect(window.sessionStorage.getItem("venviewer.deposit-return.token")).toBeNull();
  });

  it("returns as having left when the client left Stripe's page", async () => {
    keepDepositReturnToken(TOKEN);
    renderAt("/deposit-return?outcome=left");
    expect((await screen.findByTestId("where")).textContent).toBe(`/proposal-share/${TOKEN}?deposit=left`);
  });

  it("says where to look when this tab kept no token", async () => {
    renderAt("/deposit-return?outcome=returned");
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Your payment is with Stripe");
    expect(screen.getByText(/Open your proposal link/u)).toBeTruthy();
  });

  it("ignores anything kept that is not a share token", async () => {
    window.sessionStorage.setItem("venviewer.deposit-return.token", "../../admin");
    renderAt("/deposit-return?outcome=left");
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Nothing was charged");
  });
});
