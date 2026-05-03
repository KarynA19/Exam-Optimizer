import { IssueList } from "../common/IssueList";
import type { CourseInput, ScheduleSolution, ScheduledExam } from "../../types";
import type { PreviewResponse, PreviewStatus } from "../../utils/workspaceUtils";

export function ConflictDrawer({
  solution,
  selectedExam,
  selectedCourse,
  selectedPreviewDate,
  previewResponse,
  previewStatus,
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
  onApplyMove: () => void;
  onClearSelection: () => void;
  busy: boolean;
}) {
  if (!selectedExam || !selectedPreviewDate) {
    return (
      <aside className="conflict-drawer empty">
        <h3>Conflict Drawer</h3>
        <p className="empty-state">Select an exam in the calendar to preview its blocked and valid move targets.</p>
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
    <aside className="conflict-drawer">
      <h3>Conflict Drawer</h3>
      <p className="drawer-eyebrow">{selectedExam.course_code} · {selectedCourse?.course_name ?? selectedExam.course_code}</p>
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
      </div>
      <IssueList issues={previewResponse?.issues ?? []} compact />
      <div className="drawer-actions">
        <button type="button" className="accent-button" disabled={!previewResponse?.valid || busy || selectedPreviewDate === selectedExam.exam_date} onClick={onApplyMove}>
          {busy ? "Applying..." : "Apply move"}
        </button>
        <button type="button" className="secondary-button" onClick={onClearSelection}>
          Clear selection
        </button>
      </div>
    </aside>
  );
}
