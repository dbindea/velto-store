import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

/**
 * The one upload control in the app: a labelled slot that opens the picker.
 *
 * Vehicle photos and client documents used to do this two different ways — a
 * dashed box with "Hacer foto" / "Subir desde galería" on one side, a grid of
 * labelled buttons on the other — so the same task looked like two features.
 * This is both, and it fixes what each got wrong:
 *
 * - The client slots carried `capture="environment"`, which on a phone **forces
 *   the camera**: a customer's ID already photographed and sitting in the
 *   gallery could not be uploaded at all. The attribute is gone; the system
 *   picker offers camera and gallery, and it is the OS's job to know which.
 * - The vehicle box hard-coded its own hint in Spanish and let the label float
 *   between the two buttons.
 *
 * `label` is what the slot is for ("Documento frontal", "Fotos del vehículo").
 * The host passes an already-translated string, because the labels come from
 * different key sets on each side.
 */
@Component({
  selector: 'app-photo-upload-buttons',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="upload-slot" [class.busy]="busy" [attr.title]="label">
      @if (busy) {
        <i class="pi pi-spin pi-spinner"></i>
      } @else {
        <i class="pi pi-upload"></i>
      }
      <span class="slot-label">{{ label || ('common.photos.uploadFromGallery' | translate) }}</span>
      <input
        type="file"
        [attr.accept]="accept"
        [attr.multiple]="multiple ? '' : null"
        [disabled]="busy"
        (change)="onFilePicked($event)"
      />
    </label>
  `,
  styles: [`
    :host { display: block; }

    .upload-slot {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: var(--bg-main);
      border: 1px dashed var(--border-color);
      border-radius: 8px;
      color: var(--text-secondary);
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;

      i { color: var(--accent-color); }

      &:hover {
        border-color: var(--accent-color);
        color: var(--text-primary);
      }

      &.busy {
        cursor: progress;
        opacity: 0.7;
      }

      /* Visually hidden, still focusable and still the real control. */
      input[type="file"] {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    }
  `]
})
export class PhotoUploadButtonsComponent {
  /** MIME types accepted by the underlying input. */
  @Input() accept = 'image/jpeg,image/jpg,image/png,image/webp';
  /** Allow selecting more than one file per click. */
  @Input() multiple = false;
  /** Already-translated text for the slot. */
  @Input() label = '';
  /** Shows a spinner and blocks the input while the host is uploading. */
  @Input() busy = false;

  /** Emitted every time the user picks files. */
  @Output() filesPicked = new EventEmitter<FileList | null>();

  onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.filesPicked.emit(input.files);
    }
    // Reset so picking the same file twice still fires `change`.
    input.value = '';
  }
}
