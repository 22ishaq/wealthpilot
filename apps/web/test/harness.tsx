import type { ClientSummary, Dashboard, Me, Role } from "@wealthpilot/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { vi } from "vitest";

import { routes } from "../src/routes";

type Reply = [status: number, body?: unknown];
export type Handlers = Record<string, Reply | ((body: unknown) => Reply)>;

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Replace fetch with a table of "METHOD /api/path" -> [status, body]; records every call. */
export function mockApi(handlers: Handlers): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: input, body });
      const handler = handlers[`${method} ${input}`];
      const [status, payload] =
        typeof handler === "function"
          ? handler(body)
          : (handler ?? [404, { error: { code: "NOT_FOUND", message: "not mocked" } }]);
      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(payload ?? null), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
  return calls;
}

export function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

export function me(role: Role = "owner"): Me {
  return {
    user: {
      id: "0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a01",
      email: "olivia@acme.test",
      name: "Olivia Owner",
      role,
    },
    tenant: { id: "t1", name: "Acme Wealth" },
  };
}

export const emptyDashboard: Dashboard = {
  aumPence: 0,
  clientCount: 0,
  accountCount: 0,
  allocation: [],
  topClients: [],
  driftAlerts: [],
  recentActivity: [],
};

export function client(overrides: Partial<ClientSummary> = {}): ClientSummary {
  return {
    id: "c1",
    name: "Grace Hopper",
    email: "grace@example.com",
    riskProfile: "growth",
    advisor: { id: "0b6f3c2a-6d1e-4f0a-9c55-6a1d2e3f4a02", name: "Daniel Okafor" },
    valuePence: 1_234_567,
    accountCount: 2,
    maxDriftBps: 120,
    archived: false,
    createdAt: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}
