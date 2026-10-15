import {
  RISK_PROFILES,
  clientCreateSchema,
  type ClientCreateInput,
  type ClientDetail,
  type Member,
} from "@wealthpilot/shared";
import { useState, type SubmitEvent } from "react";

import { RISK_LABELS } from "../format";
import { blankToNull, fieldErrors, formValues } from "../forms";
import { ErrorAlert, Field } from "./ui";

interface Props {
  initial?: ClientDetail;
  members: Member[];
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (input: ClientCreateInput) => void;
  onCancel?: () => void;
}

/** Create or edit a client. Validates with the same schema the API enforces. */
export function ClientForm({
  initial,
  members,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const serverErrors = fieldErrors(error);
  const shown = { ...serverErrors, ...errors };
  const advisors = members.filter((member) => member.active && member.role !== "viewer");

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    const input = {
      name: values["name"] ?? "",
      email: blankToNull(values["email"]),
      riskProfile: values["riskProfile"] ?? "",
      advisorId: blankToNull(values["advisorId"]),
    };
    const parsed = clientCreateSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    onSubmit(input as ClientCreateInput);
  };

  return (
    <form className="stack" onSubmit={submit} noValidate aria-label={submitLabel}>
      {error && Object.keys(serverErrors).length === 0 ? <ErrorAlert error={error} /> : null}
      <div className="form-grid">
        <Field label="Name" error={shown["name"]}>
          <input name="name" defaultValue={initial?.name ?? ""} required />
        </Field>
        <Field label="Email (optional)" error={shown["email"]}>
          <input name="email" type="email" defaultValue={initial?.email ?? ""} />
        </Field>
        <Field label="Risk profile" error={shown["riskProfile"]}>
          <select name="riskProfile" defaultValue={initial?.riskProfile ?? "balanced"}>
            {RISK_PROFILES.map((profile) => (
              <option key={profile} value={profile}>
                {RISK_LABELS[profile]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Advisor" error={shown["advisorId"]}>
          <select name="advisorId" defaultValue={initial?.advisor?.id ?? ""}>
            <option value="">Unassigned</option>
            {advisors.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row">
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
