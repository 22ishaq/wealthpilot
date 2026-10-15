import type {
  Account,
  AccountCreateInput,
  AccountUpdateInput,
  AcceptInviteInput,
  ApiErrorBody,
  AuditEvent,
  ClientCreateInput,
  ClientDetail,
  ClientSummary,
  ClientUpdateInput,
  CreatedInvitation,
  Dashboard,
  HoldingCreateInput,
  HoldingUpdateInput,
  Invitation,
  InvitationPreview,
  InviteInput,
  InvitableRole,
  LoginInput,
  Me,
  Member,
  Security,
  SignupInput,
} from "@wealthpilot/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field-level messages from a VALIDATION_FAILED response, keyed by field path. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const errors: Record<string, string> = {};
    for (const issue of this.details as unknown[]) {
      if (typeof issue === "object" && issue !== null && "path" in issue && "message" in issue) {
        errors[String(issue.path)] = String(issue.message);
      }
    }
    return errors;
  }
}

function isErrorBody(data: unknown): data is ApiErrorBody {
  return typeof data === "object" && data !== null && "error" in data;
}

/**
 * The only place the app talks to the API. Cookies carry the session (same origin only), and
 * every body is JSON: the API rejects anything else on state-changing requests.
 */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isErrorBody(data) ? data.error : undefined;
    throw new ApiError(
      response.status,
      error?.code ?? "HTTP_ERROR",
      error?.message ?? (response.statusText || "Request failed"),
      error?.details,
    );
  }
  return data as T;
}

export const api = {
  me: () => request<Me>("GET", "/auth/me"),
  login: (input: LoginInput) => request<Me>("POST", "/auth/login", input),
  signup: (input: SignupInput) => request<Me>("POST", "/auth/signup", input),
  logout: () => request<undefined>("POST", "/auth/logout"),
  invitation: (token: string) =>
    request<InvitationPreview>("GET", `/auth/invitations/${encodeURIComponent(token)}`),
  acceptInvitation: (input: AcceptInviteInput) =>
    request<Me>("POST", "/auth/invitations/accept", input),

  dashboard: () => request<Dashboard>("GET", "/dashboard"),
  securities: () => request<Security[]>("GET", "/securities"),

  clients: (filter: { search?: string; archived?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (filter.search) params.set("search", filter.search);
    if (filter.archived) params.set("archived", "true");
    const query = params.toString();
    return request<ClientSummary[]>("GET", `/clients${query ? `?${query}` : ""}`);
  },
  client: (id: string) => request<ClientDetail>("GET", `/clients/${id}`),
  createClient: (input: ClientCreateInput) => request<ClientDetail>("POST", "/clients", input),
  updateClient: (id: string, input: ClientUpdateInput) =>
    request<ClientDetail>("PATCH", `/clients/${id}`, input),
  archiveClient: (id: string) => request<ClientDetail>("POST", `/clients/${id}/archive`),
  restoreClient: (id: string) => request<ClientDetail>("POST", `/clients/${id}/restore`),

  openAccount: (clientId: string, input: AccountCreateInput) =>
    request<Account>("POST", `/clients/${clientId}/accounts`, input),
  updateAccount: (id: string, input: AccountUpdateInput) =>
    request<Account>("PATCH", `/accounts/${id}`, input),
  closeAccount: (id: string) => request<undefined>("DELETE", `/accounts/${id}`),
  addHolding: (accountId: string, input: HoldingCreateInput) =>
    request<Account>("POST", `/accounts/${accountId}/holdings`, input),
  updateHolding: (id: string, input: HoldingUpdateInput) =>
    request<Account>("PATCH", `/holdings/${id}`, input),
  removeHolding: (id: string) => request<undefined>("DELETE", `/holdings/${id}`),

  members: () => request<Member[]>("GET", "/members"),
  invitations: () => request<Invitation[]>("GET", "/members/invitations"),
  invite: (input: InviteInput) => request<CreatedInvitation>("POST", "/members/invitations", input),
  revokeInvitation: (id: string) => request<undefined>("DELETE", `/members/invitations/${id}`),
  changeRole: (id: string, role: InvitableRole) =>
    request<Member>("PATCH", `/members/${id}`, { role }),
  deactivate: (id: string) => request<undefined>("DELETE", `/members/${id}`),

  audit: (limit = 100) => request<AuditEvent[]>("GET", `/audit?limit=${limit}`),
};
