import {
  allocate,
  type AuditEvent,
  type ClientDetail,
  type Member,
  type Security,
} from "@wealthpilot/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { client, me, mockApi, renderAt, type Handlers } from "./harness";

const securities: Security[] = [
  {
    symbol: "VWRL",
    name: "Vanguard FTSE All-World",
    assetClass: "equity",
    pricePence: 11842,
    priceDate: "2026-10-01",
  },
  {
    symbol: "IGLT",
    name: "iShares Core UK Gilts",
    assetClass: "bond",
    pricePence: 1052,
    priceDate: "2026-10-01",
  },
  {
    symbol: "SGLN",
    name: "iShares Physical Gold",
    assetClass: "commodity",
    pricePence: 4610,
    priceDate: "2026-10-01",
  },
];

const detail: ClientDetail = {
  ...client({
    id: "c1",
    name: "Grace Hopper",
    riskProfile: "balanced",
    valuePence: 2_236_200,
    maxDriftBps: 1204,
  }),
  accounts: [
    {
      id: "a1",
      name: "Stocks & Shares ISA",
      type: "isa",
      cashPence: 0,
      valuePence: 2_236_200,
      holdings: [
        {
          id: "h1",
          symbol: "VWRL",
          name: "Vanguard FTSE All-World",
          assetClass: "equity",
          quantity: "100",
          pricePence: 11842,
          valuePence: 1_184_200,
          bookCostPence: 1_000_000,
          gainPence: 184_200,
        },
        {
          id: "h2",
          symbol: "IGLT",
          name: "iShares Core UK Gilts",
          assetClass: "bond",
          quantity: "1000",
          pricePence: 1052,
          valuePence: 1_052_000,
          bookCostPence: 1_100_000,
          gainPence: -48_000,
        },
      ],
    },
  ],
  allocation: allocate({ equity: 1_184_200, bond: 1_052_000 }, "balanced").lines,
  bookCostPence: 2_100_000,
  gainPence: 136_200,
};

const members: Member[] = [
  {
    id: "0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a01",
    email: "olivia@acme.test",
    name: "Olivia Owner",
    role: "owner",
    active: true,
    createdAt: "2026-10-01T09:00:00.000Z",
  },
  {
    id: "0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a02",
    email: "daniel@acme.test",
    name: "Daniel Okafor",
    role: "advisor",
    active: true,
    createdAt: "2026-10-02T09:00:00.000Z",
  },
  {
    id: "0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a03",
    email: "tom@acme.test",
    name: "Tom Bennett",
    role: "viewer",
    active: false,
    createdAt: "2026-10-03T09:00:00.000Z",
  },
];

function detailApi(role: "owner" | "viewer", extra: Handlers = {}) {
  return mockApi({
    "GET /api/auth/me": [200, me(role)],
    "GET /api/clients/c1": [200, detail],
    "GET /api/securities": [200, securities],
    "GET /api/members": [200, members],
    ...extra,
  });
}

describe("client detail", () => {
  it("shows the portfolio, allocation against target and every holding", async () => {
    detailApi("owner");
    renderAt("/clients/c1");
    expect(await screen.findByRole("heading", { name: /Grace Hopper/ })).toBeInTheDocument();
    expect(screen.getAllByText("£22,362.00").length).toBeGreaterThan(0);
    expect(screen.getByText("+£1,362.00")).toHaveClass("positive");
    expect(screen.getByText("-£480.00")).toHaveClass("negative");
    expect(
      screen.getByRole("img", { name: "Bonds: 47.04% held, target 35.00%" }),
    ).toBeInTheDocument();
    const account = screen.getByRole("region", { name: "Stocks & Shares ISA" });
    expect(within(account).getByText("VWRL")).toBeInTheDocument();
    expect(within(account).getByText("1000")).toBeInTheDocument();
  });

  it("offers no editing controls to viewers", async () => {
    detailApi("viewer");
    renderAt("/clients/c1");
    await screen.findByRole("heading", { name: /Grace Hopper/ });
    for (const name of [
      "Edit",
      "Archive",
      "Open account",
      "Close account",
      "Add holding",
      "Remove",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("adds a holding only after validating it, and only for securities not already held", async () => {
    const calls = detailApi("owner", {
      "POST /api/accounts/a1/holdings": [201, detail.accounts[0]],
    });
    renderAt("/clients/c1");
    const form = await screen.findByRole("form", { name: "Add holding to Stocks & Shares ISA" });
    const options = within(form)
      .getAllByRole("option")
      .map((option) => option.getAttribute("value"));
    expect(options).toEqual(["SGLN"]);
    await userEvent.click(within(form).getByRole("button", { name: "Add holding" }));
    expect(await within(form).findByText(/positive number/)).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText("Quantity"), "12.5");
    await userEvent.type(within(form).getByLabelText("Book cost (£)"), "575.00");
    await userEvent.click(within(form).getByRole("button", { name: "Add holding" }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({
        symbol: "SGLN",
        quantity: "12.5",
        bookCost: "575.00",
      });
    });
  });

  it("edits and removes holdings", async () => {
    const calls = detailApi("owner", {
      "PATCH /api/holdings/h1": [200, detail.accounts[0]],
      "DELETE /api/holdings/h2": [204],
    });
    renderAt("/clients/c1");
    const account = await screen.findByRole("region", { name: "Stocks & Shares ISA" });
    await userEvent.click(within(account).getByRole("button", { name: "Edit VWRL" }));
    const quantity = within(account).getByLabelText("Quantity of VWRL");
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "150");
    await userEvent.click(within(account).getByRole("button", { name: "Save" }));
    await userEvent.click(within(account).getByRole("button", { name: "Remove IGLT" }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.method !== "GET")
          .map((call) => [call.method, call.path, call.body]),
      ).toEqual([
        ["PATCH", "/api/holdings/h1", { quantity: "150", bookCost: "10000.00" }],
        ["DELETE", "/api/holdings/h2", undefined],
      ]);
    });
  });

  it("opens and closes accounts", async () => {
    vi.stubGlobal("confirm", () => true);
    const calls = detailApi("owner", {
      "POST /api/clients/c1/accounts": [201, { ...detail.accounts[0], id: "a2" }],
      "DELETE /api/accounts/a1": [204],
    });
    renderAt("/clients/c1");
    await userEvent.click(await screen.findByRole("button", { name: "Open account" }));
    const form = screen.getByRole("form", { name: "Open account" });
    await userEvent.type(within(form).getByLabelText("Account name"), "Pension");
    await userEvent.selectOptions(within(form).getByLabelText("Type"), "sipp");
    await userEvent.click(within(form).getByRole("button", { name: "Open account" }));
    await userEvent.click(screen.getByRole("button", { name: "Close account" }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.method !== "GET")
          .map((call) => [call.method, call.path, call.body]),
      ).toEqual([
        ["POST", "/api/clients/c1/accounts", { name: "Pension", type: "sipp", cash: "0" }],
        ["DELETE", "/api/accounts/a1", undefined],
      ]);
    });
  });

  it("edits and archives the client", async () => {
    const calls = detailApi("owner", {
      "PATCH /api/clients/c1": [200, detail],
      "POST /api/clients/c1/archive": [200, { ...detail, archived: true }],
    });
    renderAt("/clients/c1");
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Save changes" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Grace Hopper");
    await userEvent.selectOptions(
      within(form).getByLabelText("Advisor"),
      "0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a02",
    );
    await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(calls.filter((call) => call.method !== "GET").map((call) => call.path)).toEqual([
        "/api/clients/c1",
        "/api/clients/c1/archive",
      ]);
    });
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      advisorId: "0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a02",
    });
  });
});

describe("team", () => {
  function teamApi(role: "owner" | "viewer", extra: Handlers = {}) {
    return mockApi({
      "GET /api/auth/me": [200, me(role)],
      "GET /api/members": [200, members],
      "GET /api/members/invitations": [
        200,
        [
          {
            id: "i1",
            email: "pending@acme.test",
            role: "viewer",
            createdAt: "2026-10-10T09:00:00.000Z",
            expiresAt: "2026-10-17T09:00:00.000Z",
          },
        ],
      ],
      ...extra,
    });
  }

  it("invites a member and shows the one-time link", async () => {
    const calls = teamApi("owner", {
      "POST /api/members/invitations": [
        201,
        {
          id: "i2",
          email: "new@acme.test",
          role: "advisor",
          createdAt: "2026-10-15T09:00:00.000Z",
          expiresAt: "2026-10-22T09:00:00.000Z",
          inviteUrl: "http://localhost:5173/invite/tok123",
        },
      ],
    });
    renderAt("/team");
    const form = await screen.findByRole("form", { name: "Invite a team member" });
    await userEvent.click(within(form).getByRole("button", { name: "Create invitation" }));
    expect(await within(form).findByText(/Invalid email/i)).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText("Email"), "new@acme.test");
    await userEvent.click(within(form).getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByLabelText("Invitation link")).toHaveValue(
      "http://localhost:5173/invite/tok123",
    );
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      email: "new@acme.test",
      role: "advisor",
    });
  });

  it("changes roles, deactivates members and revokes invitations", async () => {
    vi.stubGlobal("confirm", () => true);
    const calls = teamApi("owner", {
      "PATCH /api/members/0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a02": [
        200,
        { ...members[1], role: "viewer" },
      ],
      "DELETE /api/members/0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a02": [204],
      "DELETE /api/members/invitations/i1": [204],
    });
    renderAt("/team");
    // The owner row and the deactivated member are read-only; only Daniel is editable.
    expect(await screen.findByLabelText("Role for Daniel Okafor")).toBeInTheDocument();
    expect(screen.queryByLabelText("Role for Olivia Owner")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Role for Tom Bennett")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Role for Daniel Okafor"), "viewer");
    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(
        calls.filter((call) => call.method !== "GET").map((call) => `${call.method} ${call.path}`),
      ).toEqual([
        "PATCH /api/members/0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a02",
        "DELETE /api/members/0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a02",
        "DELETE /api/members/invitations/i1",
      ]);
    });
  });

  it("is read-only for viewers", async () => {
    teamApi("viewer");
    renderAt("/team");
    expect(await screen.findByText("Daniel Okafor")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Invite a team member" })).not.toBeInTheDocument();
    expect(screen.queryByText("Pending invitations")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("activity, signup, sign-out and unknown pages", () => {
  it("lists audit events with links to clients", async () => {
    const events: AuditEvent[] = [
      {
        id: "2",
        actor: { id: "0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a02", name: "Daniel Okafor" },
        action: "client.created",
        entityType: "client",
        entityId: "c1",
        details: { name: "Grace Hopper" },
        createdAt: "2026-10-15T09:00:00.000Z",
      },
      {
        id: "1",
        actor: null,
        action: "firm.created",
        entityType: "tenant",
        entityId: "t1",
        details: { name: "Acme" },
        createdAt: "2026-10-14T09:00:00.000Z",
      },
    ];
    mockApi({ "GET /api/auth/me": [200, me()], "GET /api/audit?limit=200": [200, events] });
    renderAt("/activity");
    expect(
      await screen.findByText("Daniel Okafor added a client: Grace Hopper"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View client" })).toHaveAttribute(
      "href",
      "/clients/c1",
    );
  });

  it("signs up a new firm", async () => {
    const calls = mockApi({
      "GET /api/auth/me": [401, { error: { code: "UNAUTHENTICATED", message: "Sign in" } }],
      "POST /api/auth/signup": [201, me()],
      "GET /api/dashboard": [
        200,
        {
          aumPence: 0,
          clientCount: 0,
          accountCount: 0,
          allocation: [],
          topClients: [],
          driftAlerts: [],
          recentActivity: [],
        },
      ],
    });
    const router = renderAt("/signup");
    await userEvent.type(await screen.findByLabelText("Firm name"), "Acme Wealth");
    await userEvent.type(screen.getByLabelText("Your name"), "Olivia Owner");
    await userEvent.type(screen.getByLabelText("Work email"), "olivia@acme.test");
    await userEvent.type(screen.getByLabelText("Password (12+ characters)"), "too short");
    await userEvent.click(screen.getByRole("button", { name: "Create firm" }));
    expect(await screen.findByText("must be at least 12 characters")).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Password (12+ characters)"),
      " but now long enough",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create firm" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
      firmName: "Acme Wealth",
    });
  });

  it("signs out", async () => {
    const calls = mockApi({
      "GET /api/auth/me": [200, me()],
      "GET /api/dashboard": [
        200,
        {
          aumPence: 0,
          clientCount: 0,
          accountCount: 0,
          allocation: [],
          topClients: [],
          driftAlerts: [],
          recentActivity: [],
        },
      ],
      "POST /api/auth/logout": [204],
    });
    const router = renderAt("/");
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(calls.some((call) => call.path === "/api/auth/logout")).toBe(true);
  });

  it("shows a not-found page for unknown paths", async () => {
    mockApi({});
    renderAt("/nowhere");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
