import { useEffect, useState } from "react";

import type { CourseInput, ScheduleSolution, ScheduledExam, ValidationIssue } from "../../types";
import { getDepartmentClassName, getDepartmentLabel, getDepartmentShortLabel } from "../../utils/departmentUtils";
import type { PreviewResponse, PreviewStatus } from "../../utils/workspaceUtils";

function getConflictKey(issue: ValidationIssue): string {
  return [issue.code, issue.related_course_code ?? "", issue.related_date ?? "", issue.message].join("|");
}

export function ConflictDrawer({
  solution,
  selectedExam,
  selectedCourse,
  selectedPreviewDate,
  previewResponse,
  previewStatus,
  activeConflict,
  onSelectConflict,
  onApplyMove,
  onClearSelection,
  busy,
}: {
  solution: ScheduleSolution;
  selectedExam: ScheduledExam | null;
  selectedCourse: CourseInput | null;
  selectedPreviewDate: string | null;
  previewResponse?: PreviewResponse;
  previewStatus: PreviewStatus;
  activeConflict: ValidationIssue | null;
  onSelectConflict: (issue: ValidationIssue) => void;
  onApplyMove: () => void;
  onClearSelection: () => void;
  busy: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const issues = previewResponse?.issues ?? [];
  const highSeverityCount = issues.filter((issue) => issue.severity === "error").length;
  const mediumSeverityCount = issues.filter((issue) => issue.severity === "warning").length;
  const toggleSeverityClass = highSeverityCount > 0 ? "severity-error" : mediumSeverityCount > 0 ? "severity-warning" : "";

  useEffect(() => {
    if (!selectedExam) {
      setIsOpen(false);
      return;
    }

    if (issues.length > 0) {
      setIsOpen(true);
    }
  }, [issues.length, selectedExam]);

  if (!selectedExam || !selectedPreviewDate) {
    return (
      <aside className="conflict-drawer collapsed empty">
        <button
          type="button"
          className={["conflict-bubble-toggle", toggleSeverityClass].filter(Boolean).join(" ")}
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? "Hide Conflicts" : "Conflicts"}
        </button>
        {isOpen ? <div className="conflict-bubble-panel"><p className="empty-state">Select an exam in the calendar to preview its blocked and valid move targets.</p></div> : null}
      </aside>
    );
  }

  const statusLabel =
    previewStatus === "red"
      ? "Hard constraint violation"
      : previewStatus === "yellow"
        ? "Valid but weaker than the current score"
        : previewStatus === "green"
          ? "Valid target"
          : "Choose a target day";
  const scoreDelta = previewResponse?.updated_solution ? previewResponse.updated_solution.score - solution.score : 0;

  return (
      <aside className={isOpen ? "conflict-drawer open" : "conflict-drawer collapsed"}>
        <button
          type="button"
          className={["conflict-bubble-toggle", toggleSeverityClass].filter(Boolean).join(" ")}
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? "Hide Conflicts" : `View Conflicts (${issues.length})`}
        </button>

        {isOpen ? (
          <div className="conflict-bubble-panel">
            <div className="conflict-bubble-header">
              <div>
                <h3>Conflicts</h3>
                <p className="drawer-eyebrow">{selectedExam.course_code} · {selectedCourse?.course_name ?? selectedExam.course_code}</p>
              </div>
              <button type="button" className="secondary-button conflict-close-button" onClick={() => setIsOpen(false)}>
                Close
              </button>
            </div>

            {selectedCourse ? (
              <div className="drawer-department-row">
                <span className={["department-badge", getDepartmentClassName(selectedCourse)].join(" ")}>{getDepartmentShortLabel(selectedCourse)}</span>
                <span>{getDepartmentLabel(selectedCourse)}</span>
              </div>
            ) : null}

            <div className="conflict-legend">
              <span><i className="conflict-dot high" />High Severity {highSeverityCount}</span>
              <span><i className="conflict-dot medium" />Medium Severity {mediumSeverityCount}</span>
              <span><i className="conflict-dot active" />Conflict Active</span>
            </div>

            <p className={`drawer-status status-${previewStatus}`}>{statusLabel}</p>
            <div className="drawer-grid">
              <div>
                <span>Current date</span>
                <strong>{selectedExam.exam_date}</strong>
              </div>
              <div>
                <span>Preview date</span>
                <strong>{selectedPreviewDate}</strong>
              </div>
              <div>
                <span>Score delta</span>
                <strong>{scoreDelta >= 0 ? `+${scoreDelta}` : scoreDelta}</strong>
              </div>
              <div>
                <span>Department</span>
                <strong>{selectedCourse ? getDepartmentShortLabel(selectedCourse) : "ALL"}</strong>
              </div>
            </div>

            {issues.length > 0 ? (
              <div className="conflict-list">
                {issues.map((issue, index) => {
                  const isActive = activeConflict ? getConflictKey(issue) === getConflictKey(activeConflict) : index === 0;

                  return (
                    <button
                      key={`${issue.code}-${index}`}
                      type="button"
                      className={[
                        "conflict-item",
                        issue.severity === "error" ? "severity-error" : "severity-warning",
                        isActive ? "active" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => onSelectConflict(issue)}
                    >
                      <div className="conflict-item-header">
                        <strong>{issue.related_course_code ?? selectedExam.course_code}</strong>
                        <span>{issue.related_date ?? selectedPreviewDate}</span>
                      </div>
                      <p>{issue.message}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">No conflicts for the current preview selection.</p>
            )}

            <div className="drawer-actions">
              <button type="button" className="accent-button" disabled={!previewResponse?.valid || busy || selectedPreviewDate === selectedExam.exam_date} onClick={onApplyMove}>
                {busy ? "Applying..." : "Apply move"}
              </button>
              <button type="button" className="secondary-button" onClick={onClearSelection}>
                Clear selection
              </button>
            </div>
          </div>
        ) : null}
    </aside>
  );
}
