/**
 * Building an internal note for a reservation.
 *
 * Pure on purpose. The note goes into Firestore inside an `arrayUnion()`
 * sentinel, and a sentinel cannot be cleaned on the way out without destroying
 * it — so the note has to leave here already free of `undefined`, or the write
 * fails with "Unsupported field value: undefined".
 *
 * That is not hypothetical: an operator with no `displayName` on their
 * authorised-user record was enough to break every note on the reservation.
 */

import { ReservationNote } from '@shared/models/reservation.model';

export interface ReservationNoteAuthor {
  displayName?: string | null;
  email?: string | null;
}

/** Random enough for a note id, with a fallback for older browsers. */
function noteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @throws when the text is empty — an empty note is not a note.
 */
export function buildReservationNote(
  text: string,
  author?: ReservationNoteAuthor
): ReservationNote {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Note text is required');

  const createdBy = (author?.displayName ?? '').trim();
  const createdByEmail = (author?.email ?? '').trim();

  const note: ReservationNote = {
    id: noteId(),
    text: trimmed,
    createdAt: { seconds: Date.now() / 1000 }
  };

  // Only set when there is something to set: assigning `undefined` is exactly
  // what Firestore rejects, and an author is genuinely optional.
  if (createdBy) note.createdBy = createdBy;
  if (createdByEmail) note.createdByEmail = createdByEmail;

  return note;
}
