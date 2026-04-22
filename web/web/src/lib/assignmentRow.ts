export type CourseRow = { name: string; code: string | null };
export type AssignmentRow = {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  priority: number | null;
  course_id: number;
  courses: CourseRow | null;
  /** Present when the row is selected with `updated_at` (e.g. dashboard). */
  updated_at?: string | null;
};

function normalizeCourseRelation(
  courses: CourseRow | CourseRow[] | null | undefined,
): CourseRow | null {
  if (!courses) {
    return null;
  }
  return Array.isArray(courses) ? (courses[0] ?? null) : courses;
}

export function normalizeAssignmentRows(raw: unknown): AssignmentRow[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as number,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      due_date: (r.due_date as string | null) ?? null,
      status: r.status as string,
      priority: (r.priority as number | null) ?? null,
      course_id: r.course_id as number,
      courses: normalizeCourseRelation(
        r.courses as CourseRow | CourseRow[] | null | undefined,
      ),
      updated_at: (r.updated_at as string | null | undefined) ?? undefined,
    };
  });
}
