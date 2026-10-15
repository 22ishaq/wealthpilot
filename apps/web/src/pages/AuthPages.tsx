import { acceptInviteSchema, loginSchema, signupSchema, type Me } from "@wealthpilot/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type SubmitEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";

import { ApiError, api } from "../api";
import { ErrorAlert, Field, Spinner } from "../components/ui";
import { ROLE_LABELS } from "../format";
import { fieldErrors, formValues } from "../forms";
import { useMe, useSignedIn } from "../session";

function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          WealthPilot
        </div>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

interface Validator {
  safeParse(value: unknown): { success: boolean; error?: unknown };
}

/** Shared submit logic: validate with the shared schema, then call the API. */
function useAuthForm(
  submit: (values: Record<string, string>) => Promise<Me>,
  schema: Validator,
  redirectTo: string,
) {
  const signedIn = useSignedIn();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: submit,
    onSuccess: (me) => {
      signedIn(me);
      void navigate(redirectTo, { replace: true });
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
    },
  });
  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    mutation.mutate(values);
  };
  return { errors, mutation, onSubmit };
}

export function LoginPage() {
  const me = useMe();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const { errors, mutation, onSubmit } = useAuthForm(
    (values) => api.login({ email: values["email"] ?? "", password: values["password"] ?? "" }),
    loginSchema,
    from,
  );
  if (me.data) return <Navigate to={from} replace />;

  return (
    <AuthCard
      title="Sign in"
      subtitle={
        <>
          New firm? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        {mutation.error &&
        !(mutation.error instanceof ApiError && mutation.error.code === "VALIDATION_FAILED") ? (
          <ErrorAlert error={mutation.error} />
        ) : null}
        <Field label="Email" error={errors["email"]}>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(errors["email"])}
          />
        </Field>
        <Field label="Password" error={errors["password"]}>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={Boolean(errors["password"])}
          />
        </Field>
        <button className="primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthCard>
  );
}

export function SignupPage() {
  const { errors, mutation, onSubmit } = useAuthForm(
    (values) =>
      api.signup({
        firmName: values["firmName"] ?? "",
        name: values["name"] ?? "",
        email: values["email"] ?? "",
        password: values["password"] ?? "",
      }),
    signupSchema,
    "/",
  );
  return (
    <AuthCard
      title="Create your firm"
      subtitle={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        {mutation.error &&
        !(mutation.error instanceof ApiError && mutation.error.code === "VALIDATION_FAILED") ? (
          <ErrorAlert error={mutation.error} />
        ) : null}
        <Field label="Firm name" error={errors["firmName"]}>
          <input name="firmName" autoComplete="organization" required />
        </Field>
        <Field label="Your name" error={errors["name"]}>
          <input name="name" autoComplete="name" required />
        </Field>
        <Field label="Work email" error={errors["email"]}>
          <input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password (12+ characters)" error={errors["password"]}>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Field>
        <button className="primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Creating…" : "Create firm"}
        </button>
      </form>
    </AuthCard>
  );
}

export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api.invitation(token),
    retry: false,
  });
  const { errors, mutation, onSubmit } = useAuthForm(
    (values) =>
      api.acceptInvitation({
        token,
        name: values["name"] ?? "",
        password: values["password"] ?? "",
      }),
    {
      safeParse: (values: unknown) =>
        acceptInviteSchema.safeParse({ ...(values as object), token }),
    },
    "/",
  );

  if (preview.isPending) return <Spinner label="Checking invitation" />;
  if (preview.isError) {
    return (
      <AuthCard
        title="Invitation unavailable"
        subtitle="This link is invalid, has expired or was already used."
      >
        <p>
          Ask whoever invited you for a new link, or <Link to="/login">sign in</Link>.
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={`Join ${preview.data.firmName}`}
      subtitle={`You've been invited as ${ROLE_LABELS[preview.data.role]} (${preview.data.email}).`}
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        <ErrorAlert error={mutation.error} />
        <Field label="Your name" error={errors["name"]}>
          <input name="name" autoComplete="name" required />
        </Field>
        <Field label="Choose a password (12+ characters)" error={errors["password"]}>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Field>
        <button className="primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Joining…" : "Join firm"}
        </button>
      </form>
    </AuthCard>
  );
}
