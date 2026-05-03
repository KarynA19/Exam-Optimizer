import { useState } from "react";

import type { FixedExam } from "../../types";

export function FixedExamForm({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue?: FixedExam;
  onSubmit: (exam: FixedExam) => void;
  onCancel?: () => void;
}) {
  const [courseCode, setCourseCode] = useState(initialValue?.course_code ?? "");
  const [examDate, setExamDate] = useState(initialValue?.exam_date ?? "");
  const [reason, setReason] = useState(initialValue?.reason ?? "");

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ course_code: courseCode, exam_date: examDate, locked: true, reason });
        setCourseCode("");
        setExamDate("");
        setReason("");
      }}
    >
      <div className="field-row">
        <label>
          <span>Course code</span>
          <input value={courseCode} onChange={(event) => setCourseCode(event.target.value)} required />
        </label>
        <label>
          <span>Exam date</span>
          <input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} required />
        </label>
      </div>
      <label>
        <span>Reason</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div className="button-row button-row-inline">
        <button type="submit">{initialValue ? "Save fixed exam" : "Add fixed exam"}</button>
        {onCancel ? (
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
