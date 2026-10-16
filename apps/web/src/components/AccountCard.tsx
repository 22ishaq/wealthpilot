import {
  ACCOUNT_TYPE_LABELS,
  formatMoney,
  holdingCreateSchema,
  toDecimalString,
  type Account,
  type Holding,
  type Security,
} from "@wealthpilot/shared";
import { useMutation } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";

import { api } from "../api";
import { fieldErrors, formValues } from "../forms";
import { ErrorAlert, Field, Money } from "./ui";

interface Props {
  account: Account;
  securities: Security[];
  canWrite: boolean;
  onChanged: () => void;
}

function HoldingRow({
  holding,
  canWrite,
  onChanged,
}: {
  holding: Holding;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const update = useMutation({
    mutationFn: (values: { quantity: string; bookCost: string }) =>
      api.updateHolding(holding.id, values),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.removeHolding(holding.id),
    onSuccess: onChanged,
  });

  if (editing) {
    return (
      <tr>
        <td colSpan={7}>
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              const values = formValues(event.currentTarget);
              update.mutate({
                quantity: values["quantity"] ?? "",
                bookCost: values["bookCost"] ?? "",
              });
            }}
          >
            <strong>{holding.symbol}</strong>
            <input
              name="quantity"
              aria-label={`Quantity of ${holding.symbol}`}
              defaultValue={holding.quantity}
              style={{ width: 120 }}
            />
            <input
              name="bookCost"
              aria-label={`Book cost of ${holding.symbol} (£)`}
              defaultValue={toDecimalString(holding.bookCostPence)}
              style={{ width: 140 }}
            />
            <button className="primary small" type="submit" disabled={update.isPending}>
              Save
            </button>
            <button
              className="small"
              type="button"
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <ErrorAlert error={update.error} />
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <strong>{holding.symbol}</strong>
        <div className="muted">{holding.name}</div>
      </td>
      <td className="num">{holding.quantity}</td>
      <td className="num">{formatMoney(holding.pricePence)}</td>
      <td className="num">{formatMoney(holding.valuePence)}</td>
      <td className="num">{formatMoney(holding.bookCostPence)}</td>
      <td className="num">
        <Money pence={holding.gainPence} signed />
      </td>
      <td className="num">
        {canWrite ? (
          <span className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
            <button
              className="small"
              type="button"
              onClick={() => {
                setEditing(true);
              }}
              aria-label={`Edit ${holding.symbol}`}
            >
              Edit
            </button>
            <button
              className="small danger"
              type="button"
              disabled={remove.isPending}
              aria-label={`Remove ${holding.symbol}`}
              onClick={() => {
                remove.mutate();
              }}
            >
              Remove
            </button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function AddHoldingForm({ account, securities, onChanged }: Omit<Props, "canWrite">) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: (input: { symbol: string; quantity: string; bookCost: string }) =>
      api.addHolding(account.id, input),
    onSuccess: () => {
      setErrors({});
      onChanged();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
    },
  });
  const held = new Set(account.holdings.map((holding) => holding.symbol));
  const available = securities.filter((security) => !held.has(security.symbol));

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formValues(form);
    const input = {
      symbol: values["symbol"] ?? "",
      quantity: values["quantity"] ?? "",
      bookCost: values["bookCost"] ?? "",
    };
    const parsed = holdingCreateSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    add.mutate(input, {
      onSuccess: () => {
        form.reset();
      },
    });
  };

  if (available.length === 0) return null;
  return (
    <form
      className="form-grid"
      onSubmit={submit}
      noValidate
      aria-label={`Add holding to ${account.name}`}
    >
      <Field label="Security" error={errors["symbol"]}>
        <select name="symbol">
          {available.map((security) => (
            <option key={security.symbol} value={security.symbol}>
              {security.symbol} · {security.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Quantity" error={errors["quantity"]}>
        <input name="quantity" inputMode="decimal" placeholder="10" />
      </Field>
      <Field label="Book cost (£)" error={errors["bookCost"]}>
        <input name="bookCost" inputMode="decimal" placeholder="1000.00" />
      </Field>
      <div>
        <button className="primary" type="submit" disabled={add.isPending}>
          Add holding
        </button>
      </div>
      {add.error && Object.keys(fieldErrors(add.error)).length === 0 ? (
        <ErrorAlert error={add.error} />
      ) : null}
    </form>
  );
}

export function AccountCard({ account, securities, canWrite, onChanged }: Props) {
  const close = useMutation({
    mutationFn: () => api.closeAccount(account.id),
    onSuccess: onChanged,
  });
  return (
    <section className="account stack" aria-label={account.name}>
      <div className="card-header" style={{ margin: 0 }}>
        <div>
          <h3>{account.name}</h3>
          <div className="muted">
            {ACCOUNT_TYPE_LABELS[account.type]} · Cash {formatMoney(account.cashPence)}
          </div>
        </div>
        <div className="row">
          <strong className="num">{formatMoney(account.valuePence)}</strong>
          {canWrite ? (
            <button
              className="small danger"
              type="button"
              disabled={close.isPending}
              onClick={() => {
                if (window.confirm(`Close ${account.name} and remove its holdings?`))
                  close.mutate();
              }}
            >
              Close account
            </button>
          ) : null}
        </div>
      </div>
      {account.holdings.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Security</th>
                <th className="num">Quantity</th>
                <th className="num">Price</th>
                <th className="num">Value</th>
                <th className="num">Book cost</th>
                <th className="num">Gain / loss</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {account.holdings.map((holding) => (
                <HoldingRow
                  key={holding.id}
                  holding={holding}
                  canWrite={canWrite}
                  onChanged={onChanged}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          No holdings yet.
        </p>
      )}
      {canWrite ? (
        <AddHoldingForm account={account} securities={securities} onChanged={onChanged} />
      ) : null}
    </section>
  );
}
