/** Hand-off channel: Study Studio → 3D Classroom (client-only, survives a route change/reload). */
import type { StudyLessonContent } from "./classroom2d/lesson";

const KEY = "ustad.classroom.handoff";

export type ClassroomHandoff = {
  topic: string;
  content?: StudyLessonContent;
  autoplay?: boolean;
  fieldTrip?: boolean;
  studentLevel?: "beginner" | "intermediate" | "advanced";
  sourceType?: "topic" | "ai-answer" | "textbook" | "pdf" | "notes" | "chat";
  sourceId?: string;
  chapter?: string;
};

export function setClassroomHandoff(payload: ClassroomHandoff): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(KEY, JSON.stringify(payload));
}

export function takeClassroomHandoff(): ClassroomHandoff | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(KEY);
  try {
    return JSON.parse(raw) as ClassroomHandoff;
  } catch {
    return null;
  }
}
