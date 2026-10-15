import { allocate, type AuditEvent } from "@wealthpilot/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AllocationChart, DriftBars } from "../src/components/charts";
import { DriftBadge, Money } from "../src/components/ui";
import { describeEvent, timeAgo } from "../src/format";

describe("AllocationChart", () => {
  it("draws one arc per held asset class and lists every class with its value", () => {
    const { lines } = allocate({ equity: 750_000, bond: 250_000 }, "balanced");
    render(<AllocationChart lines={lines} />);
    expect(screen.getByTestId("arc-equity")).toBeInTheDocument();
    expect(screen.getByTestId("arc-bond")).toBeInTheDocument();
    expect(screen.queryByTestId("arc-cash")).not.toBeInTheDocument();
    expect(screen.getByText("£7,500.00")).toBeInTheDocument();
    expect(screen.getByText("75.00%")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("shows an empty state with no assets", () => {
    render(<AllocationChart lines={allocate({}, "growth").lines} />);
    expect(screen.getByText("No assets yet")).toBeInTheDocument();
  });
});

describe("DriftBars", () => {
  it("labels each class with its weight, target and drift", () => {
    const { lines } = allocate({ equity: 1_184_200, bond: 1_052_000 }, "balanced");
    render(<DriftBars lines={lines} />);
    expect(
      screen.getByRole("img", { name: "Bonds: 47.04% held, target 35.00%" }),
    ).toBeInTheDocument();
    expect(screen.getByText("+12.04%")).toHaveClass("negative");
    expect(screen.getByText("+2.96%")).toHaveClass("muted");
  });
});

describe("badges and money", () => {
  it("flags drift beyond the alert threshold", () => {
    const { rerender } = render(<DriftBadge bps={600} hasAssets />);
    expect(screen.getByText("Drift 6.00%")).toHaveClass("warn");
    rerender(<DriftBadge bps={100} hasAssets />);
    expect(screen.getByText("On target")).toBeInTheDocument();
    rerender(<DriftBadge bps={0} hasAssets={false} />);
    expect(screen.getByText("No assets")).toBeInTheDocument();
  });

  it("colours signed amounts", () => {
    const { rerender } = render(<Money pence={1500} signed />);
    expect(screen.getByText("+£15.00")).toHaveClass("positive");
    rerender(<Money pence={-1500} signed />);
    expect(screen.getByText("-£15.00")).toHaveClass("negative");
  });
});

describe("format", () => {
  const event = (overrides: Partial<AuditEvent>): AuditEvent => ({
    id: "1",
    actor: { id: "u", name: "Priya" },
    action: "client.created",
    entityType: "client",
    entityId: "c",
    details: { name: "Ada" },
    createdAt: "2026-10-15T10:00:00.000Z",
    ...overrides,
  });

  it("describes audit events in plain English", () => {
    expect(describeEvent(event({}))).toBe("Priya added a client: Ada");
    expect(describeEvent(event({ action: "holding.added", details: { symbol: "VWRL" } }))).toBe(
      "Priya added a holding: VWRL",
    );
    expect(describeEvent(event({ actor: null, action: "custom.thing", details: {} }))).toBe(
      "Someone custom.thing",
    );
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-10-15T12:00:00.000Z");
    expect(timeAgo("2026-10-15T11:59:30.000Z", now)).toBe("just now");
    expect(timeAgo("2026-10-15T11:00:00.000Z", now)).toBe("1 hour ago");
    expect(timeAgo("2026-10-13T12:00:00.000Z", now)).toBe("2 days ago");
  });
});
