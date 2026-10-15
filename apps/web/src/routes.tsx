import type { RouteObject } from "react-router";

import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { ActivityPage, NotFoundPage } from "./pages/ActivityPage";
import { AcceptInvitePage, LoginPage, SignupPage } from "./pages/AuthPages";
import { ClientDetailPage } from "./pages/ClientDetailPage";
import { ClientsPage } from "./pages/ClientsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { TeamPage } from "./pages/TeamPage";

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
  { path: "/invite/:token", element: <AcceptInvitePage /> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "clients", element: <ClientsPage /> },
      { path: "clients/:clientId", element: <ClientDetailPage /> },
      { path: "team", element: <TeamPage /> },
      { path: "activity", element: <ActivityPage /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];
