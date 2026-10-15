import { formatMoney } from "@wealthpilot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Link, useNavigate } from "react-router";

import { api } from "../api";
import { ClientForm } from "../components/ClientForm";
import { DriftBadge, Empty, ErrorAlert, PageHeader, RiskBadge, Spinner } from "../components/ui";
import { useCan } from "../session";

export function ClientsPage() {
  const canWrite = useCan("clients:write");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const deferredSearch = useDeferredValue(search.trim());
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const clients = useQuery({
    queryKey: ["clients", { search: deferredSearch, archived }],
    queryFn: () => api.clients({ search: deferredSearch, archived }),
  });
  const members = useQuery({ queryKey: ["members"], queryFn: api.members, enabled: creating });
  const create = useMutation({
    mutationFn: api.createClient,
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void navigate(`/clients/${client.id}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Households and the portfolios you manage for them"
        actions={
          canWrite && !creating ? (
            <button
              className="primary"
              type="button"
              onClick={() => {
                setCreating(true);
              }}
            >
              New client
            </button>
          ) : null
        }
      />
      {creating ? (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <h2>New client</h2>
          <ClientForm
            members={members.data ?? []}
            submitLabel="Create client"
            pending={create.isPending}
            error={create.error}
            onSubmit={(input) => {
              create.mutate(input);
            }}
            onCancel={() => {
              setCreating(false);
            }}
          />
        </section>
      ) : null}
      <section className="card">
        <div className="card-header">
          <input
            type="search"
            placeholder="Search by name or email"
            aria-label="Search clients"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            style={{ maxWidth: 320 }}
          />
          <label className="row muted">
            <input
              type="checkbox"
              checked={archived}
              onChange={(event) => {
                setArchived(event.target.checked);
              }}
              style={{ width: "auto" }}
            />
            Archived
          </label>
        </div>
        {clients.isPending ? (
          <Spinner />
        ) : clients.isError ? (
          <ErrorAlert error={clients.error} />
        ) : clients.data.length === 0 ? (
          <Empty>{deferredSearch ? "No clients match your search." : "No clients yet."}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Risk profile</th>
                  <th>Advisor</th>
                  <th className="num">Accounts</th>
                  <th className="num">Value</th>
                  <th>Allocation</th>
                </tr>
              </thead>
              <tbody>
                {clients.data.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link to={`/clients/${client.id}`}>{client.name}</Link>
                      {client.email ? <div className="muted">{client.email}</div> : null}
                    </td>
                    <td>
                      <RiskBadge profile={client.riskProfile} />
                    </td>
                    <td>{client.advisor?.name ?? <span className="muted">Unassigned</span>}</td>
                    <td className="num">{client.accountCount}</td>
                    <td className="num">{formatMoney(client.valuePence)}</td>
                    <td>
                      <DriftBadge bps={client.maxDriftBps} hasAssets={client.valuePence > 0} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
