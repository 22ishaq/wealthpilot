import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api } from "../api";
import { Empty, ErrorAlert, PageHeader, Spinner } from "../components/ui";
import { describeEvent, formatDateTime } from "../format";

export function ActivityPage() {
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api.audit(200) });
  return (
    <>
      <PageHeader title="Activity" subtitle="An append-only record of every change in your firm" />
      <section className="card">
        {audit.isPending ? (
          <Spinner />
        ) : audit.isError ? (
          <ErrorAlert error={audit.error} />
        ) : audit.data.length === 0 ? (
          <Empty>No activity yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What happened</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.map((event) => (
                  <tr key={event.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(event.createdAt)}
                    </td>
                    <td>{describeEvent(event)}</td>
                    <td>
                      {event.entityType === "client" && event.entityId ? (
                        <Link to={`/clients/${event.entityId}`}>View client</Link>
                      ) : (
                        <span className="muted">{event.entityType}</span>
                      )}
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

export function NotFoundPage() {
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1>Page not found</h1>
        <p className="muted">
          That page doesn&apos;t exist. <Link to="/">Go to the dashboard</Link>.
        </p>
      </div>
    </div>
  );
}
