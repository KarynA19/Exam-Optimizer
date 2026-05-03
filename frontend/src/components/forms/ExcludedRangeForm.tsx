import { useState } from "react";

import type { ExcludedDateRange } from "../../types";

export function ExcludedRangeForm({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue?: ExcludedDateRange;
  onSubmit: (range: ExcludedDateRange) => void;
  onCancel?: () => void;
}) {
  const [startDate, setStartDate] = useState(initialValue?.start_date ?? "");
  const [endDate, setEndDate] = useState(initialValue?.end_date ?? "");
  const [reason, setReason] = useState(initialValue?.reason ?? "");

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ start_date: startDate, end_date: endDate, reason });
        setStartDate("");
        setEndDate("");
        setReason("");
      }}
    >
      <div className="field-row">
        <label>
          <span>Start</span>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
        </label>
        <label>
          <span>End</span>
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
        </label>
      </div>
      <label>
        <span>Reason</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} required />
      </label>
      <div className="button-row button-row-inline">
        <button type="submit">{initialValue ? "Save excluded range" : "Add excluded range"}</button>
        {onCancel ? (
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
