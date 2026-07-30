import {
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
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
 * Pure presentation: parent owns the data, this component emits
 * `addNote` with the typed body and refreshes the local cache when
 * the service confirms the write.
 */
@Component({
  selector: 'app-reservation-notes-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './reservation-notes-panel.component.html',
  styleUrl: './reservation-notes-panel.component.scss'
})
export class ReservationNotesPanelComponent {
  @Input({ required: true }) reservationId!: string;
  @Input() notes: ReservationNote[] = [];

  @Output() notesChanged = new EventEmitter<ReservationNote[]>();

  private reservationService = inject(ReservationService);

  draft = signal('');
  saving = signal(false);
  error = signal<string | null>(null);

  // Show newest first
  sortedNotes = computed<ReservationNote[]>(() =>
    [...(this.notes || [])].sort((a, b) => {
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
      const created = await this.reservationService.addInternalNote(this.reservationId, text);
      this.notesChanged.emit([...(this.notes || []), created]);
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
