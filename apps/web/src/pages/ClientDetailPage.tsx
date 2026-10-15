import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  accountCreateSchema,
  formatBps,
} from "@wealthpilot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";
import { Link, useParams } from "react-router";

import { ApiError, api } from "../api";
import { AccountCard } from "../components/AccountCard";
import { AllocationChart, DriftBars } from "../components/charts";
import { ClientForm } from "../components/ClientForm";
import {
  DriftBadge,
  Empty,
  ErrorAlert,
  Field,
  Money,
  PageHeader,
  RiskBadge,
  Spinner,
  Stat,
} from "../components/ui";
import { blankToNull, fieldErrors, formValues } from "../forms";
import { useCan } from "../session";

function OpenAccountForm({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const open = useMutation({
    mutationFn: (input: { name: string; type: string; cash: string }) =>
      api.openAccount(clientId, input as Parameters<typeof api.openAccount>[1]),
    onSuccess: onDone,
    onError: (error) => {
      setErrors(fieldErrors(error));
    },
  });
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    const input = {
      name: values["name"] ?? "",
      type: values["type"] ?? "",
      cash: blankToNull(values["cash"]) ?? "0",
    };
    const parsed = accountCreateSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    open.mutate(input);
  };
  return (
    <form className="form-grid" onSubmit={submit} noValidate aria-label="Open account">
      <Field label="Account name" error={errors["name"]}>
        <input name="name" placeholder="Stocks & Shares ISA" />
      </Field>
      <Field label="Type" error={errors["type"]}>
        <select name="type">
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {ACCOUNT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cash (£)" error={errors["cash"]}>
        <input name="cash" inputMode="decimal" placeholder="0.00" />
      </Field>
      <div>
        <button className="primary" type="submit" disabled={open.isPending}>
          Open account
        </button>
      </div>
    </form>
  );
}

export function ClientDetailPage() {
  const { clientId = "" } = useParams();
  const canWrite = useCan("clients:write");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [openingAccount, setOpeningAccount] = useState(false);

  const client = useQuery({ queryKey: ["client", clientId], queryFn: () => api.client(clientId) });
  const securities = useQuery({
    queryKey: ["securities"],
    queryFn: api.securities,
    staleTime: 3_600_000,
  });
  const members = useQuery({ queryKey: ["members"], queryFn: api.members, enabled: editing });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["client", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateClient>[1]) =>
      api.updateClient(clientId, input),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      archived ? api.restoreClient(clientId) : api.archiveClient(clientId),
    onSuccess: refresh,
  });

  if (client.isPending) return <Spinner />;
  if (client.isError) {
    if (client.error instanceof ApiError && client.error.status === 404) {
      return (
        <Empty>
          This client does not exist or belongs to another firm.{" "}
          <Link to="/clients">Back to clients</Link>
        </Empty>
      );
    }
    return <ErrorAlert error={client.error} />;
  }
  const data = client.data;

  return (
    <>
      <p style={{ margin: "0 0 0.5rem" }}>
        <Link to="/clients">← Clients</Link>
      </p>
      <PageHeader
        title={
          <span className="row">
            {data.name} <RiskBadge profile={data.riskProfile} />
            {data.archived ? <span className="badge">Archived</span> : null}
          </span>
        }
        subtitle={[
          data.email,
          data.advisor ? `Advisor: ${data.advisor.name}` : "No advisor assigned",
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          canWrite ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing((value) => !value);
                }}
              >
                {editing ? "Close editor" : "Edit"}
              </button>
              <button
                type="button"
                disabled={archive.isPending}
                onClick={() => {
                  archive.mutate(data.archived);
                }}
              >
                {data.archived ? "Restore" : "Archive"}
              </button>
            </>
          ) : null
        }
      />
      {editing ? (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <h2>Edit client</h2>
          <ClientForm
            initial={data}
            members={members.data ?? []}
            submitLabel="Save changes"
            pending={update.isPending}
            error={update.error}
            onSubmit={(input) => {
              update.mutate(input);
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        </section>
      ) : null}
      <section className="grid stats" aria-label="Portfolio summary">
        <Stat label="Portfolio value" value={<Money pence={data.valuePence} />} />
        <Stat label="Book cost" value={<Money pence={data.bookCostPence} />} />
        <Stat label="Gain / loss" value={<Money pence={data.gainPence} signed />} />
        <Stat
          label="Largest drift"
          value={data.valuePence > 0 ? formatBps(data.maxDriftBps) : "—"}
          hint={<DriftBadge bps={data.maxDriftBps} hasAssets={data.valuePence > 0} />}
        />
      </section>
      <div className="grid two" style={{ marginBottom: "1rem" }}>
        <section className="card">
          <h2>Allocation</h2>
          <AllocationChart lines={data.allocation} />
        </section>
        <section className="card">
          <h2>Against target</h2>
          {data.valuePence > 0 ? (
            <DriftBars lines={data.allocation} />
          ) : (
            <Empty>No assets yet</Empty>
          )}
        </section>
      </div>
      <section className="card stack">
        <div className="card-header" style={{ margin: 0 }}>
          <h2>Accounts</h2>
          {canWrite ? (
            <button
              type="button"
              onClick={() => {
                setOpeningAccount((value) => !value);
              }}
            >
              {openingAccount ? "Cancel" : "Open account"}
            </button>
          ) : null}
        </div>
        {openingAccount ? (
          <OpenAccountForm
            clientId={clientId}
            onDone={() => {
              setOpeningAccount(false);
              refresh();
            }}
          />
        ) : null}
        {data.accounts.length === 0 ? (
          <Empty>No accounts yet.</Empty>
        ) : (
          data.accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              securities={securities.data ?? []}
              canWrite={canWrite}
              onChanged={refresh}
            />
          ))
        )}
      </section>
    </>
  );
}
