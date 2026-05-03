import { useEffect, useRef, useState } from "react";

import { explainMoveProject, importCoursesSpreadsheet, manualMoveProject, solveProject, validateProject } from "./api";
import { EditableSimpleList } from "./components/common/EditableSimpleList";
import { IssueList } from "./components/common/IssueList";
import { Metric } from "./components/common/Metric";
import { SectionTitle } from "./components/common/SectionTitle";
import { CourseForm } from "./components/forms/CourseForm";
import { ExcludedRangeForm } from "./components/forms/ExcludedRangeForm";
import { FixedExamForm } from "./components/forms/FixedExamForm";
import { ComparisonDashboard } from "./components/workspace/ComparisonDashboard";
import { ConflictDrawer } from "./components/workspace/ConflictDrawer";
import { DependencyGraph } from "./components/workspace/DependencyGraph";
import { MasterCalendar } from "./components/workspace/MasterCalendar";
import { SolutionCard } from "./components/workspace/SolutionCard";
import { loadProject, saveProject } from "./storage/localProject";
import type {
  CourseInput,
  CourseImportResponse,
  ExcludedDateRange,
  FixedExam,
  ScheduleProject,
  ScheduleSolution,
  ScheduledExam,
  ValidationIssue,
} from "./types";
import { buildCalendarDays } from "./utils/calendarUtils";
import { getExamMoveKey, getPreviewKey, hasExamChanged } from "./utils/examKeys";
import {
  buildDependencyEdges,
  getPreviewStatus,
  type PreviewResponse,
} from "./utils/workspaceUtils";

type SetupStep = "project" | "excluded" | "fixed" | "courses";

const SETUP_STEPS: Array<{ id: SetupStep; title: string; subtitle: string }> = [
  {
    id: "project",
    title: "Project Setup",
    subtitle: "Define the Moed A window and draft metadata.",
  },
  {
    id: "excluded",
    title: "Excluded Dates",
    subtitle: "Block holidays or unavailable spans.",
  },
  {
    id: "fixed",
    title: "Fixed Exams",
    subtitle: "Lock courses that already have confirmed exam dates.",
  },
  {
    id: "courses",
    title: "Courses",
    subtitle: "Add courses manually or replace the current list from the Excel template.",
  },
];

function App() {
  const [project, setProject] = useState<ScheduleProject>(() => loadProject());
  const [status, setStatus] = useState<string>("Draft saved locally.");
  const [busyAction, setBusyAction] = useState<"validate" | "solve" | "manual-move" | "import-courses" | null>(null);
  const [editingExcludedIndex, setEditingExcludedIndex] = useState<number | null>(null);
  const [editingFixedExamIndex, setEditingFixedExamIndex] = useState<number | null>(null);
  const [editingCourseIndex, setEditingCourseIndex] = useState<number | null>(null);
  const [courseImportIssues, setCourseImportIssues] = useState<ValidationIssue[]>([]);
  const [moveDrafts, setMoveDrafts] = useState<Record<string, string>>({});
  const [movingExamKey, setMovingExamKey] = useState<string | null>(null);
  const [selectedSolutionId, setSelectedSolutionId] = useState<string | null>(null);
  const [selectedExamKey, setSelectedExamKey] = useState<string | null>(null);
  const [selectedPreviewDate, setSelectedPreviewDate] = useState<string | null>(null);
  const [previewResponses, setPreviewResponses] = useState<Record<string, PreviewResponse>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [graphFocusCourseCode, setGraphFocusCourseCode] = useState<string | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"calendar" | "compare" | "graph">("calendar");
  const [activeSetupStep, setActiveSetupStep] = useState<SetupStep>("project");
  const [selectedCourseFileName, setSelectedCourseFileName] = useState<string>("");
  const [coursesListCollapsed, setCoursesListCollapsed] = useState(false);
  const courseImportInputRef = useRef<HTMLInputElement | null>(null);

  const courseNameByCode = Object.fromEntries(project.courses.map((course) => [course.course_code, course.course_name]));
  const courseByCode = Object.fromEntries(project.courses.map((course) => [course.course_code, course]));
  const calendarDays = buildCalendarDays(project);
  const calendarDayKey = calendarDays.join("|");
  const semesterRows = Array.from(new Set(project.courses.map((course) => course.semester_number))).sort((left, right) => left - right);
  const activeSolution = project.solutions.find((solution) => solution.solution_id === selectedSolutionId) ?? project.solutions[0] ?? null;
  const selectedExam = activeSolution && selectedExamKey
    ? activeSolution.exams.find((exam) => getExamMoveKey(activeSolution.solution_id, exam.course_code) === selectedExamKey) ?? null
    : null;
  const selectedCourse = selectedExam ? courseByCode[selectedExam.course_code] : null;
  const dependencyEdges = buildDependencyEdges(project);
  const activeSetupStepIndex = SETUP_STEPS.findIndex((step) => step.id === activeSetupStep);
  const currentSetupStep = SETUP_STEPS[activeSetupStepIndex] ?? SETUP_STEPS[0];
  const previousSetupStep = activeSetupStepIndex > 0 ? SETUP_STEPS[activeSetupStepIndex - 1] : null;
  const nextSetupStep = activeSetupStepIndex < SETUP_STEPS.length - 1 ? SETUP_STEPS[activeSetupStepIndex + 1] : null;

  useEffect(() => {
    saveProject(project);
  }, [project]);

  useEffect(() => {
    if (project.solutions.length === 0) {
      setSelectedSolutionId(null);
      setSelectedExamKey(null);
      setSelectedPreviewDate(null);
      return;
    }

    if (!selectedSolutionId || !project.solutions.some((solution) => solution.solution_id === selectedSolutionId)) {
      setSelectedSolutionId(project.solutions[0].solution_id);
    }
  }, [project.solutions, selectedSolutionId]);

  useEffect(() => {
    setPreviewResponses({});
    setSelectedPreviewDate(null);
  }, [selectedSolutionId, selectedExamKey, project.solutions]);

  useEffect(() => {
    if (!activeSolution || !selectedExam) {
      return;
    }

    let ignore = false;
    setPreviewLoading(true);

    Promise.all(
      calendarDays.map(async (dateText) => {
        const previewKey = getPreviewKey(activeSolution.solution_id, selectedExam.course_code, dateText);
        const response = await explainMoveProject(project, activeSolution.solution_id, selectedExam.course_code, dateText);
        return [previewKey, response] as const;
      }),
    )
      .then((results) => {
        if (!ignore) {
          setPreviewResponses(Object.fromEntries(results));
        }
      })
      .catch((error) => {
        if (!ignore) {
          setStatus(error instanceof Error ? error.message : "Move preview failed.");
        }
      })
      .finally(() => {
        if (!ignore) {
          setPreviewLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [activeSolution, calendarDayKey, project, selectedExam]);

  function patchProject(patch: Partial<ScheduleProject>) {
    setProject((current) => ({ ...current, ...patch, solutions: [], issues: [] }));
    setStatus("Draft updated locally.");
  }

  function changeSetupStep(step: SetupStep) {
    setEditingExcludedIndex(null);
    setEditingFixedExamIndex(null);
    setEditingCourseIndex(null);
    setActiveSetupStep(step);
  }

  function saveExcludedRange(range: ExcludedDateRange) {
    patchProject({
      excluded_ranges:
        editingExcludedIndex === null
          ? [...project.excluded_ranges, range]
          : project.excluded_ranges.map((currentRange, index) =>
              index === editingExcludedIndex ? range : currentRange,
            ),
    });
    setEditingExcludedIndex(null);
  }

  function removeExcludedRange(indexToRemove: number) {
    patchProject({
      excluded_ranges: project.excluded_ranges.filter((_, index) => index !== indexToRemove),
    });
    setEditingExcludedIndex(null);
  }

  function saveFixedExam(exam: FixedExam) {
    patchProject({
      fixed_exams:
        editingFixedExamIndex === null
          ? [...project.fixed_exams, exam]
          : project.fixed_exams.map((currentExam, index) =>
              index === editingFixedExamIndex ? exam : currentExam,
            ),
    });
    setEditingFixedExamIndex(null);
  }

  function removeFixedExam(indexToRemove: number) {
    patchProject({
      fixed_exams: project.fixed_exams.filter((_, index) => index !== indexToRemove),
    });
    setEditingFixedExamIndex(null);
  }

  function saveCourse(course: CourseInput) {
    setCourseImportIssues([]);
    patchProject({
      courses:
        editingCourseIndex === null
          ? [...project.courses, course]
          : project.courses.map((currentCourse, index) => (index === editingCourseIndex ? course : currentCourse)),
    });
    setEditingCourseIndex(null);
  }

  function removeCourse(indexToRemove: number) {
    setCourseImportIssues([]);
    patchProject({
      courses: project.courses.filter((_, index) => index !== indexToRemove),
    });
    setEditingCourseIndex(null);
  }

  async function handleCourseImport(file: File) {
    setBusyAction("import-courses");
    setCourseImportIssues([]);
    setSelectedCourseFileName(file.name);
    setStatus(`Importing courses from ${file.name}...`);

    try {
      const result: CourseImportResponse = await importCoursesSpreadsheet(file);

      patchProject({ courses: result.courses });
      setEditingCourseIndex(null);
      setSelectedSolutionId(null);
      setSelectedExamKey(null);
      setSelectedPreviewDate(null);
      setGraphFocusCourseCode(null);
      changeSetupStep("courses");
      setStatus(`Imported ${result.imported_count} courses from ${file.name}.`);
    } catch (error) {
      if (Array.isArray(error)) {
        setCourseImportIssues(error as ValidationIssue[]);
        setStatus("Excel import failed. Review the reported rows.");
      } else {
        setStatus(error instanceof Error ? error.message : "Course import failed.");
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleValidate() {
    setBusyAction("validate");
    setStatus("Checking project rules...");
    try {
      const validatedProject = await validateProject(project);
      setProject(validatedProject);
      setStatus("Validation finished.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Validation failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSolve() {
    setBusyAction("solve");
    setStatus("Generating schedule options...");
    try {
      const solved = await solveProject(project);
      const nextSolutions = (solved.solutions as ScheduleProject["solutions"]).map((solution) => ({
        ...solution,
        original_exams: solution.original_exams ?? solution.exams.map((exam) => ({ ...exam })),
        original_score: solution.original_score ?? solution.score,
      }));

      setProject((current) => ({
        ...current,
        solutions: nextSolutions,
        issues: solved.issues as ValidationIssue[],
      }));
      setSelectedSolutionId(nextSolutions[0]?.solution_id ?? null);
      setSelectedExamKey(null);
      setGraphFocusCourseCode(null);
      setStatus("Solver response received.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Solve failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleManualMove(solution: ScheduleSolution, exam: ScheduledExam, explicitDate?: string) {
    const moveKey = getExamMoveKey(solution.solution_id, exam.course_code);
    const newDate = explicitDate ?? moveDrafts[moveKey] ?? exam.exam_date;

    if (newDate === exam.exam_date) {
      setStatus(`Select a new date for ${exam.course_code} before moving it.`);
      return;
    }

    setBusyAction("manual-move");
    setMovingExamKey(moveKey);
    setStatus(`Validating manual move for ${exam.course_code}...`);

    try {
      const response = await manualMoveProject(project, solution.solution_id, exam.course_code, newDate);

      setProject((current) => ({
        ...current,
        solutions: current.solutions.map((currentSolution) => {
          if (currentSolution.solution_id !== solution.solution_id) {
            return currentSolution;
          }

          const preservedOriginalExams = currentSolution.original_exams ?? currentSolution.exams.map((currentExam) => ({ ...currentExam }));
          const preservedOriginalScore = currentSolution.original_score ?? currentSolution.score;

          if (response.valid && response.updated_solution) {
            return {
              ...currentSolution,
              ...response.updated_solution,
              issues: response.issues,
              original_exams: preservedOriginalExams,
              original_score: preservedOriginalScore,
            };
          }

          return {
            ...currentSolution,
            issues: response.issues,
            original_exams: preservedOriginalExams,
            original_score: preservedOriginalScore,
          };
        }),
      }));

      setMoveDrafts((current) => ({
        ...current,
        [moveKey]: newDate,
      }));
      setSelectedPreviewDate(newDate);
      setStatus(
        response.valid
          ? `Moved ${exam.course_code} to ${newDate}.`
          : `Move rejected for ${exam.course_code}. Review the reported issues.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Manual move failed.");
    } finally {
      setBusyAction(null);
      setMovingExamKey(null);
    }
  }

  function handleResetSolution(solutionId: string) {
    setProject((current) => ({
      ...current,
      solutions: current.solutions.map((solution) => {
        if (solution.solution_id !== solutionId || !solution.original_exams) {
          return solution;
        }

        return {
          ...solution,
          exams: solution.original_exams.map((exam) => ({ ...exam })),
          score: solution.original_score ?? solution.score,
          issues: [],
        };
      }),
    }));
    setSelectedPreviewDate(null);
    setStatus(`Reset ${solutionId} back to its original solver schedule.`);
  }

  const previewResponse = activeSolution && selectedExam && selectedPreviewDate
    ? previewResponses[getPreviewKey(activeSolution.solution_id, selectedExam.course_code, selectedPreviewDate)]
    : undefined;
  const previewStatus = activeSolution && selectedExam && selectedPreviewDate
    ? getPreviewStatus(activeSolution, selectedPreviewDate, selectedExam, previewResponse)
    : "idle";

  return (
    <div className="app-shell">
      <aside className="hero-panel">
        <p className="eyebrow">Exam Optimizer</p>
        <h1>Build Moed A schedules around real academic rules.</h1>
        <p className="hero-copy">
          The master calendar is now the operational source of truth. Pick a solution, inspect dependency pressure, preview allowed move targets, and apply changes with validation guardrails.
        </p>
        <div className="status-card">
          <span className="status-label">Workspace status</span>
          <strong>{status}</strong>
        </div>
        <div className="stats-grid">
          <Metric label="Courses" value={project.courses.length} />
          <Metric label="Excluded ranges" value={project.excluded_ranges.length} />
          <Metric label="Fixed exams" value={project.fixed_exams.length} />
          <Metric label="Solutions" value={project.solutions.length} />
        </div>
      </aside>

      <main className="workspace-grid">
        <section className="panel panel-wide setup-panel">
          <div className="setup-flow-header">
            <SectionTitle title={currentSetupStep.title} subtitle={currentSetupStep.subtitle} />
            <div className="setup-stepper" aria-label="Setup progress">
              {SETUP_STEPS.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  className={step.id === activeSetupStep ? "setup-step active" : "setup-step"}
                  onClick={() => changeSetupStep(step.id)}
                >
                  <span className="setup-step-index">{index + 1}</span>
                  <span className="setup-step-copy">
                    <strong>{step.title}</strong>
                    <small>{step.subtitle}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="setup-step-panel">
            {activeSetupStep === "project" ? (
              <div className="setup-step-content">
                <label>
                  <span>Project name</span>
                  <input
                    value={project.project_name}
                    onChange={(event) => patchProject({ project_name: event.target.value })}
                  />
                </label>
                <div className="field-row">
                  <label>
                    <span>Start date</span>
                    <input
                      type="date"
                      value={project.moed_a_window.start_date}
                      onChange={(event) =>
                        patchProject({
                          moed_a_window: { ...project.moed_a_window, start_date: event.target.value },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>End date</span>
                    <input
                      type="date"
                      value={project.moed_a_window.end_date}
                      onChange={(event) =>
                        patchProject({
                          moed_a_window: { ...project.moed_a_window, end_date: event.target.value },
                        })
                      }
                    />
                  </label>
                </div>
                <div className="field-row field-row-triple">
                  <label>
                    <span>Same semester gap</span>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={project.constraint_config.same_semester_gap_days}
                      onChange={(event) =>
                        patchProject({
                          constraint_config: {
                            ...project.constraint_config,
                            same_semester_gap_days: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Prerequisite gap</span>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={project.constraint_config.prerequisite_gap_days}
                      onChange={(event) =>
                        patchProject({
                          constraint_config: {
                            ...project.constraint_config,
                            prerequisite_gap_days: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>High-failure gap</span>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={project.constraint_config.high_failure_gap_days}
                      onChange={(event) =>
                        patchProject({
                          constraint_config: {
                            ...project.constraint_config,
                            high_failure_gap_days: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {activeSetupStep === "excluded" ? (
              <div className="setup-step-content">
                <ExcludedRangeForm
                  key={editingExcludedIndex === null ? "new-excluded-range" : `edit-excluded-range-${editingExcludedIndex}`}
                  initialValue={editingExcludedIndex === null ? undefined : project.excluded_ranges[editingExcludedIndex]}
                  onSubmit={saveExcludedRange}
                  onCancel={editingExcludedIndex === null ? undefined : () => setEditingExcludedIndex(null)}
                />
                <EditableSimpleList
                  items={project.excluded_ranges.map((range) => `${range.start_date} to ${range.end_date} - ${range.reason}`)}
                  emptyMessage="No blocked dates yet."
                  onEdit={setEditingExcludedIndex}
                  onRemove={removeExcludedRange}
                />
              </div>
            ) : null}

            {activeSetupStep === "fixed" ? (
              <div className="setup-step-content">
                <FixedExamForm
                  key={editingFixedExamIndex === null ? "new-fixed-exam" : `edit-fixed-exam-${editingFixedExamIndex}`}
                  initialValue={editingFixedExamIndex === null ? undefined : project.fixed_exams[editingFixedExamIndex]}
                  onSubmit={saveFixedExam}
                  onCancel={editingFixedExamIndex === null ? undefined : () => setEditingFixedExamIndex(null)}
                />
                <EditableSimpleList
                  items={project.fixed_exams.map((exam) => `${exam.course_code} on ${exam.exam_date}`)}
                  emptyMessage="No fixed exams yet."
                  onEdit={setEditingFixedExamIndex}
                  onRemove={removeFixedExam}
                />
              </div>
            ) : null}

            {activeSetupStep === "courses" ? (
              <div className="setup-step-content">
                <div className="stack-form import-panel">
                  <div className="file-input-row">
                    <div>
                      <span className="file-input-label">Excel course template</span>
                      <p className="field-hint">Expected columns: Course ID, Course Name, Semester, Is High Failure, Prerequisites. Import replaces the current course list.</p>
                    </div>
                    <div className="file-input-controls">
                      <input
                        ref={courseImportInputRef}
                        className="file-input-hidden"
                        type="file"
                        accept=".xlsx"
                        disabled={busyAction !== null}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) {
                            void handleCourseImport(file);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busyAction !== null}
                        onClick={() => courseImportInputRef.current?.click()}
                      >
                        {busyAction === "import-courses" ? "Importing..." : "Choose file"}
                      </button>
                      <span className="file-input-name">{selectedCourseFileName || "No file selected"}</span>
                    </div>
                  </div>
                  {courseImportIssues.length > 0 ? <IssueList issues={courseImportIssues} compact /> : null}
                </div>
                <CourseForm
                  key={editingCourseIndex === null ? "new-course" : `edit-course-${editingCourseIndex}`}
                  initialValue={editingCourseIndex === null ? undefined : project.courses[editingCourseIndex]}
                  onSubmit={saveCourse}
                  onCancel={editingCourseIndex === null ? undefined : () => setEditingCourseIndex(null)}
                />
                <div className="list-section-header">
                  <div>
                    <strong>Current course list</strong>
                    <p className="field-hint">{project.courses.length} courses in the current draft.</p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setCoursesListCollapsed((current) => !current)}
                  >
                    {coursesListCollapsed ? "Expand list" : "Collapse list"}
                  </button>
                </div>
                {!coursesListCollapsed ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Name</th>
                          <th>Semester</th>
                          <th>High failure</th>
                          <th>Prerequisite</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {project.courses.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="empty-row">
                              No courses added yet.
                            </td>
                          </tr>
                        ) : (
                          project.courses.map((course, index) => (
                            <tr key={`${course.course_code}-${index}`}>
                              <td>{course.course_code}</td>
                              <td>{course.course_name}</td>
                              <td>{course.semester_number}</td>
                              <td>{course.high_failure_rate ? "Yes" : "No"}</td>
                              <td>{course.prerequisite_course_code || "-"}</td>
                              <td>
                                <div className="row-actions">
                                  <button type="button" className="secondary-button" onClick={() => setEditingCourseIndex(index)}>
                                    Edit
                                  </button>
                                  <button type="button" className="danger-button" onClick={() => removeCourse(index)}>
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="setup-flow-footer">
            <div className="setup-summary-row">
              <span>{project.excluded_ranges.length} excluded ranges</span>
              <span>{project.fixed_exams.length} fixed exams</span>
              <span>{project.courses.length} courses</span>
            </div>
            <div className="button-row setup-actions">
              {previousSetupStep ? (
                <button type="button" className="secondary-button" onClick={() => changeSetupStep(previousSetupStep.id)}>
                  Previous
                </button>
              ) : null}
              {nextSetupStep ? (
                <button type="button" onClick={() => changeSetupStep(nextSetupStep.id)}>
                  Next: {nextSetupStep.title}
                </button>
              ) : (
                <>
                  <button onClick={handleValidate} disabled={busyAction !== null}>
                    {busyAction === "validate" ? "Validating..." : "Validate draft"}
                  </button>
                  <button className="accent-button" onClick={handleSolve} disabled={busyAction !== null}>
                    {busyAction === "solve" ? "Solving..." : "Generate options"}
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="panel panel-wide">
          <div className="workspace-tabs">
            <button
              type="button"
              className={activeWorkspaceTab === "calendar" ? "solution-tab active" : "solution-tab"}
              onClick={() => setActiveWorkspaceTab("calendar")}
            >
              Calendar
            </button>
            <button
              type="button"
              className={activeWorkspaceTab === "compare" ? "solution-tab active" : "solution-tab"}
              onClick={() => setActiveWorkspaceTab("compare")}
            >
              Compare
            </button>
            <button
              type="button"
              className={activeWorkspaceTab === "graph" ? "solution-tab active" : "solution-tab"}
              onClick={() => setActiveWorkspaceTab("graph")}
            >
              Graph
            </button>
          </div>

          <div className="workspace-tab-panel">
            {activeWorkspaceTab === "calendar" ? (
              <>
                <SectionTitle title="Master Calendar" subtitle="Primary solution view with semester rows, Moed days, and move-preview overlays." />
                {project.solutions.length === 0 || !activeSolution ? (
                  <p className="empty-state">Generate schedules to unlock the master calendar.</p>
                ) : (
                  <>
                    <div className="calendar-toolbar">
                      <div className="solution-tabs">
                        {project.solutions.map((solution) => (
                          <button
                            key={solution.solution_id}
                            type="button"
                            className={solution.solution_id === activeSolution.solution_id ? "solution-tab active" : "solution-tab"}
                            onClick={() => {
                              setSelectedSolutionId(solution.solution_id);
                              setSelectedExamKey(null);
                              setGraphFocusCourseCode(null);
                            }}
                          >
                            {solution.solution_id}
                          </button>
                        ))}
                      </div>
                      <div className="calendar-actions">
                        <button type="button" className="secondary-button" onClick={() => setShowChanges((current) => !current)}>
                          {showChanges ? "Hide changes" : "Show changes"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!activeSolution.original_exams || !activeSolution.exams.some((exam) => hasExamChanged(activeSolution, exam.course_code))}
                          onClick={() => handleResetSolution(activeSolution.solution_id)}
                        >
                          Reset to optimal
                        </button>
                      </div>
                    </div>

                    <div className="calendar-layout">
                      <MasterCalendar
                        project={project}
                        solution={activeSolution}
                        calendarDays={calendarDays}
                        semesterRows={semesterRows}
                        courseNameByCode={courseNameByCode}
                        courseByCode={courseByCode}
                        selectedExam={selectedExam}
                        selectedPreviewDate={selectedPreviewDate}
                        previewResponses={previewResponses}
                        previewLoading={previewLoading}
                        showChanges={showChanges}
                        onSelectExam={(exam) => {
                          setSelectedExamKey(getExamMoveKey(activeSolution.solution_id, exam.course_code));
                          setSelectedPreviewDate(exam.exam_date);
                          setGraphFocusCourseCode(exam.course_code);
                        }}
                        onSelectPreviewDate={setSelectedPreviewDate}
                      />
                      <ConflictDrawer
                        solution={activeSolution}
                        selectedExam={selectedExam}
                        selectedCourse={selectedCourse}
                        selectedPreviewDate={selectedPreviewDate}
                        previewResponse={previewResponse}
                        previewStatus={previewStatus}
                        onApplyMove={() => {
                          if (selectedExam && selectedPreviewDate) {
                            void handleManualMove(activeSolution, selectedExam, selectedPreviewDate);
                          }
                        }}
                        onClearSelection={() => {
                          setSelectedExamKey(null);
                          setSelectedPreviewDate(null);
                        }}
                        busy={busyAction === "manual-move"}
                      />
                    </div>
                  </>
                )}
              </>
            ) : null}

            {activeWorkspaceTab === "compare" ? (
              <>
                <SectionTitle title="Comparison Dashboard" subtitle="Compare generated and manually edited solutions side by side." />
                {project.solutions.length === 0 ? (
                  <p className="empty-state">No solutions available for comparison.</p>
                ) : (
                  <ComparisonDashboard solutions={project.solutions} activeSolutionId={activeSolution?.solution_id ?? null} onSelectSolution={setSelectedSolutionId} />
                )}
              </>
            ) : null}

            {activeWorkspaceTab === "graph" ? (
              <>
                <SectionTitle title="Dependency Graph" subtitle="See why a course is hard to move by following semester and prerequisite links." />
                {project.courses.length === 0 ? (
                  <p className="empty-state">Add courses to see the constraint graph.</p>
                ) : (
                  <DependencyGraph
                    courses={project.courses}
                    solution={activeSolution}
                    edges={dependencyEdges}
                    focusCourseCode={graphFocusCourseCode}
                    changedCourseCodes={activeSolution ? activeSolution.exams.filter((exam) => hasExamChanged(activeSolution, exam.course_code)).map((exam) => exam.course_code) : []}
                    onSelectCourse={(courseCode) => setGraphFocusCourseCode(courseCode || null)}
                  />
                )}
              </>
            ) : null}
          </div>
        </section>

        <section className="panel panel-wide">
          <SectionTitle title="Solution Details" subtitle="Secondary detail table with direct date input controls for the active solution." />
          {activeSolution ? (
            <SolutionCard
              solution={activeSolution}
              courseNameByCode={courseNameByCode}
              courseByCode={courseByCode}
              moveDrafts={moveDrafts}
              movingExamKey={movingExamKey}
              disabled={busyAction !== null}
              showChanges={showChanges}
              onDraftChange={(solutionId, courseCode, nextDate) => {
                setMoveDrafts((current) => ({
                  ...current,
                  [getExamMoveKey(solutionId, courseCode)]: nextDate,
                }));
              }}
              onMove={handleManualMove}
            />
          ) : (
            <p className="empty-state">No active solution selected.</p>
          )}
        </section>

        <section className="panel panel-wide">
          <SectionTitle title="Issues" subtitle="Validation and solver feedback will appear here." />
          <IssueList issues={project.issues} />
        </section>
      </main>
    </div>
  );
}

export default App;
