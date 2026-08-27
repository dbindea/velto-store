import {
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { toDate } from '@shared/utils/reservation-date.util';
import { ReservationNote } from '@shared/models/reservation.model';
import { ReservationService } from '@features/reservations/services/reservation.service';

/**
 * Append-only feed of internal notes attached to a reservation.
 *
 * Pure presentation: the parent owns the data and passes it in. The panel
 * writes the note and then does NOTHING to its own list — the reservation is a
 * live `onSnapshot` (F-15), so Firestore delivers the new note by itself, and
 * immediately, thanks to latency compensation.
 *
 * It used to also append the note optimistically. Once the list actually
 * refreshed, that raced the snapshot and every note appeared twice.
 */
@Component({
  selector: 'app-reservation-notes-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './reservation-notes-panel.component.html',
  styleUrl: './reservation-notes-panel.component.scss'
})
export class ReservationNotesPanelComponent {
  /**
   * Signal inputs, not `@Input()` properties — and that distinction is the
   * whole reason this panel works.
   *
   * `sortedNotes` below is a `computed()`. A computed only re-evaluates when a
   * SIGNAL it read changes; reading a plain `@Input()` property registers no
   * dependency at all. So the list was computed once, on creation, and never
   * again: adding a note wrote it to Firestore correctly and the operator saw
   * nothing happen until they reloaded the page — which invites them to write
   * the same note twice.
   */
  readonly reservationId = input.required<string>();
  readonly notes = input<ReservationNote[]>([]);


  private reservationService = inject(ReservationService);

  draft = signal('');
  saving = signal(false);
  error = signal<string | null>(null);

  // Show newest first
  sortedNotes = computed<ReservationNote[]>(() =>
    [...this.notes()].sort((a, b) => {
      const ta = toDate(a.createdAt).getTime();
      const tb = toDate(b.createdAt).getTime();
      return tb - ta;
    })
  );

  noteDate(n: ReservationNote): Date {
    return toDate(n.createdAt);
  }

  async submit(): Promise<void> {
    const text = this.draft().trim();
    if (!text || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      // The live snapshot on the reservation brings the note back to us.
      await this.reservationService.addInternalNote(this.reservationId(), text);
      this.draft.set('');
    } catch (err: any) {
      this.error.set(err?.message || 'Error');
    } finally {
      this.saving.set(false);
    }
  }

  onInputChange(value: string): void {
    this.draft.set(value);
  }
}
