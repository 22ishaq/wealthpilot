import {
  INVITABLE_ROLES,
  inviteSchema,
  type CreatedInvitation,
  type InvitableRole,
} from "@wealthpilot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";

import { api } from "../api";
import { Empty, ErrorAlert, Field, PageHeader, Spinner } from "../components/ui";
import { ROLE_LABELS, formatDateTime } from "../format";
import { fieldErrors, formValues } from "../forms";
import { useCan, useMe } from "../session";

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const invite = useMutation({
    mutationFn: api.invite,
    onSuccess: (invitation) => {
      setCreated(invitation);
      onInvited();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
    },
  });
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    const input = { email: values["email"] ?? "", role: values["role"] ?? "" };
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    invite.mutate({ email: input.email, role: input.role as InvitableRole });
  };

  return (
    <div className="stack">
      <form className="form-grid" onSubmit={submit} noValidate aria-label="Invite a team member">
        <Field label="Email" error={errors["email"]}>
          <input name="email" type="email" placeholder="colleague@yourfirm.com" />
        </Field>
        <Field label="Role" error={errors["role"]}>
          <select name="role" defaultValue="advisor">
            {INVITABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <button className="primary" type="submit" disabled={invite.isPending}>
            Create invitation
          </button>
        </div>
      </form>
      {invite.error && Object.keys(fieldErrors(invite.error)).length === 0 ? (
        <ErrorAlert error={invite.error} />
      ) : null}
      {created ? (
        <div className="alert success" role="status">
          <p style={{ margin: "0 0 0.5rem" }}>
            Share this one-time link with {created.email}. It expires{" "}
            {formatDateTime(created.expiresAt)} and is shown only once.
          </p>
          <div className="copy-box">
            <input
              readOnly
              value={created.inviteUrl}
              aria-label="Invitation link"
              onFocus={(event) => {
                event.target.select();
              }}
            />
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(created.inviteUrl)}
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TeamPage() {
  const { data: me } = useMe();
  const canManage = useCan("members:manage");
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ["members"], queryFn: api.members });
  const invitations = useQuery({
    queryKey: ["invitations"],
    queryFn: api.invitations,
    enabled: canManage,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["members"] });
    void queryClient.invalidateQueries({ queryKey: ["invitations"] });
  };
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: InvitableRole }) => api.changeRole(id, role),
    onSuccess: refresh,
  });
  const deactivate = useMutation({ mutationFn: api.deactivate, onSuccess: refresh });
  const revoke = useMutation({ mutationFn: api.revokeInvitation, onSuccess: refresh });

  return (
    <>
      <PageHeader title="Team" subtitle="Everyone in your firm and what they can do" />
      <div className="stack">
        {canManage ? (
          <section className="card">
            <h2>Invite a team member</h2>
            <InviteForm onInvited={refresh} />
          </section>
        ) : null}
        <section className="card">
          <h2>Members</h2>
          <ErrorAlert error={changeRole.error ?? deactivate.error} />
          {members.isPending ? (
            <Spinner />
          ) : members.isError ? (
            <ErrorAlert error={members.error} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {members.data.map((member) => {
                    const editable =
                      canManage &&
                      member.role !== "owner" &&
                      member.id !== me?.user.id &&
                      member.active;
                    return (
                      <tr key={member.id}>
                        <td>
                          <strong>{member.name}</strong>
                          <div className="muted">{member.email}</div>
                        </td>
                        <td>
                          {editable ? (
                            <select
                              aria-label={`Role for ${member.name}`}
                              value={member.role}
                              onChange={(event) => {
                                changeRole.mutate({
                                  id: member.id,
                                  role: event.target.value as InvitableRole,
                                });
                              }}
                              style={{ width: "auto" }}
                            >
                              {INVITABLE_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {ROLE_LABELS[role]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            ROLE_LABELS[member.role]
                          )}
                        </td>
                        <td>
                          {member.active ? (
                            <span className="badge ok">Active</span>
                          ) : (
                            <span className="badge">Deactivated</span>
                          )}
                        </td>
                        <td className="num">
                          {editable ? (
                            <button
                              className="small danger"
                              type="button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Deactivate ${member.name}? They will be signed out immediately.`,
                                  )
                                ) {
                                  deactivate.mutate(member.id);
                                }
                              }}
                            >
                              Deactivate
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {canManage ? (
          <section className="card">
            <h2>Pending invitations</h2>
            {invitations.data && invitations.data.length > 0 ? (
              <table>
                <tbody>
                  {invitations.data.map((invitation) => (
                    <tr key={invitation.id}>
                      <td>{invitation.email}</td>
                      <td>{ROLE_LABELS[invitation.role]}</td>
                      <td className="muted">Expires {formatDateTime(invitation.expiresAt)}</td>
                      <td className="num">
                        <button
                          className="small"
                          type="button"
                          onClick={() => {
                            revoke.mutate(invitation.id);
                          }}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No pending invitations.</Empty>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
