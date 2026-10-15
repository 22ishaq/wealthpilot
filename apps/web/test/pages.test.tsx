import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { client, emptyDashboard, me, mockApi, renderAt } from "./harness";

const unauthenticated = [
  401,
  { error: { code: "UNAUTHENTICATED", message: "Sign in to continue" } },
] as const;

describe("authentication", () => {
  it("sends signed-out visitors to the sign-in page", async () => {
    mockApi({ "GET /api/auth/me": [...unauthenticated] });
    const router = renderAt("/clients");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("validates the form before calling the API", async () => {
    const calls = mockApi({ "GET /api/auth/me": [...unauthenticated] });
    renderAt("/login");
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Invalid email/i)).toBeInTheDocument();
    expect(calls.filter((call) => call.path === "/api/auth/login")).toHaveLength(0);
  });

  it("shows the API's message for wrong credentials", async () => {
    mockApi({
      "GET /api/auth/me": [...unauthenticated],
      "POST /api/auth/login": [
        401,
        { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" } },
      ],
    });
    renderAt("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "olivia@acme.test");
    await userEvent.type(screen.getByLabelText("Password"), "wrong password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect");
  });

  it("signs in and lands on the dashboard", async () => {
    const calls = mockApi({
      "GET /api/auth/me": [...unauthenticated],
      "POST /api/auth/login": [200, me()],
      "GET /api/dashboard": [200, emptyDashboard],
    });
    const router = renderAt("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "olivia@acme.test");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("heading", { name: "Good to see you, Olivia" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(calls.find((call) => call.path === "/api/auth/login")?.body).toEqual({
      email: "olivia@acme.test",
      password: "correct horse battery staple",
    });
  });

  it("explains an invalid invitation link", async () => {
    mockApi({
      "GET /api/auth/me": [...unauthenticated],
      "GET /api/auth/invitations/abc": [
        404,
        { error: { code: "NOT_FOUND", message: "Invitation not found" } },
      ],
    });
    renderAt("/invite/abc");
    expect(
      await screen.findByRole("heading", { name: "Invitation unavailable" }),
    ).toBeInTheDocument();
  });

  it("previews a valid invitation", async () => {
    mockApi({
      "GET /api/auth/me": [...unauthenticated],
      "GET /api/auth/invitations/tok": [
        200,
        { firmName: "Acme Wealth", email: "new@acme.test", role: "advisor" },
      ],
    });
    renderAt("/invite/tok");
    expect(await screen.findByRole("heading", { name: "Join Acme Wealth" })).toBeInTheDocument();
    expect(screen.getByText(/invited as Advisor \(new@acme.test\)/)).toBeInTheDocument();
  });
});

describe("dashboard", () => {
  it("shows key figures, top clients and drift alerts", async () => {
    mockApi({
      "GET /api/auth/me": [200, me()],
      "GET /api/dashboard": [
        200,
        {
          ...emptyDashboard,
          aumPence: 123_456_789,
          clientCount: 2,
          accountCount: 3,
          topClients: [client()],
          driftAlerts: [client({ id: "c2", name: "Drifty", maxDriftBps: 900 })],
        },
      ],
    });
    renderAt("/");
    expect(await screen.findByText("£1,234,567.89")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Grace Hopper" })).toHaveAttribute(
      "href",
      "/clients/c1",
    );
    expect(screen.getByText("9.00% off target")).toBeInTheDocument();
  });
});

describe("clients", () => {
  it("lists clients with value, advisor and drift", async () => {
    mockApi({
      "GET /api/auth/me": [200, me()],
      "GET /api/clients": [
        200,
        [client(), client({ id: "c2", name: "Ada", advisor: null, valuePence: 0 })],
      ],
    });
    renderAt("/clients");
    const table = await screen.findByRole("table");
    const [, grace, ada, ...rest] = within(table).getAllByRole("row");
    expect(rest).toHaveLength(0);
    if (!grace || !ada) throw new Error("expected two client rows");
    expect(within(grace).getByText("£12,345.67")).toBeInTheDocument();
    expect(within(grace).getByText("Daniel Okafor")).toBeInTheDocument();
    expect(within(ada).getByText("Unassigned")).toBeInTheDocument();
    expect(within(ada).getByText("No assets")).toBeInTheDocument();
  });

  it("hides write actions from viewers", async () => {
    mockApi({ "GET /api/auth/me": [200, me("viewer")], "GET /api/clients": [200, []] });
    renderAt("/clients");
    expect(await screen.findByText("No clients yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New client" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Activity" })).not.toBeInTheDocument();
  });

  it("searches as you type", async () => {
    const calls = mockApi({
      "GET /api/auth/me": [200, me()],
      "GET /api/clients": [200, [client()]],
      "GET /api/clients?search=gr": [200, [client()]],
    });
    renderAt("/clients");
    await userEvent.type(await screen.findByLabelText("Search clients"), "gr");
    await waitFor(() => {
      expect(calls.some((call) => call.path === "/api/clients?search=gr")).toBe(true);
    });
  });

  it("creates a client with validated input and opens it", async () => {
    const calls = mockApi({
      "GET /api/auth/me": [200, me()],
      "GET /api/clients": [200, []],
      "GET /api/members": [
        200,
        [
          {
            id: "0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a01",
            email: "o@a.test",
            name: "Olivia Owner",
            role: "owner",
            active: true,
            createdAt: "",
          },
        ],
      ],
      "POST /api/clients": [
        201,
        { ...client({ id: "new" }), accounts: [], allocation: [], bookCostPence: 0, gainPence: 0 },
      ],
      "GET /api/clients/new": [404, { error: { code: "NOT_FOUND", message: "Client not found" } }],
    });
    const router = renderAt("/clients");
    await userEvent.click(await screen.findByRole("button", { name: "New client" }));
    await userEvent.click(screen.getByRole("button", { name: "Create client" }));
    expect(await screen.findByText("is required")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "Katherine Johnson");
    await userEvent.selectOptions(screen.getByLabelText("Risk profile"), "conservative");
    await userEvent.click(screen.getByRole("button", { name: "Create client" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/clients/new");
    });
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "Katherine Johnson",
      email: null,
      riskProfile: "conservative",
      advisorId: null,
    });
  });

  it("explains a client that is missing or belongs to another firm", async () => {
    mockApi({
      "GET /api/auth/me": [200, me()],
      "GET /api/clients/other": [
        404,
        { error: { code: "NOT_FOUND", message: "Client not found" } },
      ],
      "GET /api/securities": [200, []],
    });
    renderAt("/clients/other");
    expect(
      await screen.findByText(/does not exist or belongs to another firm/),
    ).toBeInTheDocument();
  });
});
