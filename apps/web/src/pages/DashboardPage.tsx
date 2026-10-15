import { DRIFT_ALERT_BPS, formatBps, formatMoney } from "@wealthpilot/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api } from "../api";
import { AllocationChart } from "../components/charts";
import { Empty, ErrorAlert, Money, PageHeader, RiskBadge, Spinner, Stat } from "../components/ui";
import { describeEvent, timeAgo } from "../format";
import { useMe } from "../session";

export function DashboardPage() {
  const { data: me } = useMe();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });

  if (dashboard.isPending) return <Spinner />;
  if (dashboard.isError) return <ErrorAlert error={dashboard.error} />;
  const data = dashboard.data;

  return (
    <>
      <PageHeader
        title={`Good to see you, ${me?.user.name.split(" ")[0] ?? ""}`}
        subtitle={`${me?.tenant.name ?? ""} at a glance`}
      />
      <section className="grid stats" aria-label="Key figures">
        <Stat label="Assets under management" value={formatMoney(data.aumPence)} />
        <Stat label="Clients" value={data.clientCount} />
        <Stat label="Accounts" value={data.accountCount} />
        <Stat
          label="Need rebalancing"
          value={data.driftAlerts.length}
          hint={`Drift over ${formatBps(DRIFT_ALERT_BPS)} from target`}
        />
      </section>
      <div className="grid two">
        <section className="card">
          <h2>Firm allocation</h2>
          <AllocationChart lines={data.allocation} />
        </section>
        <section className="card">
          <h2>Largest clients</h2>
          {data.topClients.length === 0 ? (
            <Empty>
              No clients yet. <Link to="/clients">Add your first client</Link>.
            </Empty>
          ) : (
            <table>
              <tbody>
                {data.topClients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link to={`/clients/${client.id}`}>{client.name}</Link>
                    </td>
                    <td>
                      <RiskBadge profile={client.riskProfile} />
                    </td>
                    <td className="num">
                      <Money pence={client.valuePence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Rebalancing alerts</h2>
          {data.driftAlerts.length === 0 ? (
            <Empty>Every portfolio is within {formatBps(DRIFT_ALERT_BPS)} of its target.</Empty>
          ) : (
            <table>
              <tbody>
                {data.driftAlerts.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link to={`/clients/${client.id}`}>{client.name}</Link>
                    </td>
                    <td className="num">
                      <span className="badge warn">{formatBps(client.maxDriftBps)} off target</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Recent activity</h2>
          {data.recentActivity.length === 0 ? (
            <Empty>Nothing yet.</Empty>
          ) : (
            <ul className="legend">
              {data.recentActivity.map((event) => (
                <li key={event.id} style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>{describeEvent(event)}</span>
                  <span className="muted">{timeAgo(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
