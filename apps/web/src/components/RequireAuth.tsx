import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { ApiError } from "../api";
import { useMe } from "../session";
import { ErrorAlert, Spinner } from "./ui";

/** Renders its children only for a signed-in user; otherwise sends them to sign in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <Spinner label="Checking your session" />;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }
    return (
      <div className="auth-page">
        <ErrorAlert error={me.error} />
      </div>
    );
  }
  return children;
}
