import { NavLink, Outlet, useNavigate } from "react-router";

import { ROLE_LABELS } from "../format";
import { useCan, useLogout, useMe } from "../session";

export function Layout() {
  const { data: me } = useMe();
  const canReadAudit = useCan("audit:read");
  const logout = useLogout();
  const navigate = useNavigate();

  if (!me) return null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" />
          WealthPilot
        </a>
        <div className="firm-name">{me.tenant.name}</div>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/clients">Clients</NavLink>
          <NavLink to="/team">Team</NavLink>
          {canReadAudit ? <NavLink to="/activity">Activity</NavLink> : null}
        </nav>
        <div className="user-card">
          <div>
            <strong>{me.user.name}</strong>
            <div className="muted">
              {ROLE_LABELS[me.user.role]} · {me.user.email}
            </div>
          </div>
          <button
            type="button"
            className="small"
            disabled={logout.isPending}
            onClick={() => {
              logout.mutate(undefined, {
                onSettled: () => {
                  void navigate("/login");
                },
              });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
