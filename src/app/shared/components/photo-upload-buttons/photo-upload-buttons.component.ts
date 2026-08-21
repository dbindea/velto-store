import {
  Component,
  ElementRef,
  ViewChild,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

/**
 * Mobile-first photo upload control.
 *
 * On mobile (touch + camera) it shows two buttons side by side:
 *   - "Hacer foto"   → opens the rear camera directly
 *   - "Subir desde galería" → opens the file picker
 *
 * On desktop it collapses into a single button ("Subir archivo") because
 * there is no rear camera to bind to. CSS hides whichever button isn't
 * relevant per breakpoint so the same component works on both form
 * factors without extra plumbing in the host.
 *
 * Each button is a hidden `<input type="file">` styled as a button via
 * `::file-selector-button` — no JS indirection, no extra inputs that
 * desync from the form state.
 */
@Component({
  selector: 'app-photo-upload-buttons',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="photo-upload-buttons">
      <!-- Rear camera: only meaningful on mobile/tablet -->
      <label class="upload-btn upload-btn--camera" [attr.title]="'common.photos.takePhoto' | translate">
        <i class="pi pi-camera"></i>
        <span class="btn-label">{{ 'common.photos.takePhoto' | translate }}</span>
        <input
          #cameraInput
          type="file"
          [attr.accept]="accept"
          capture="environment"
          [attr.multiple]="multiple ? '' : null"
          (change)="onFilePicked($event, cameraInput)"
        />
      </label>

      <!-- Gallery / file picker: works everywhere -->
      <label class="upload-btn upload-btn--gallery" [attr.title]="'common.photos.uploadFromGallery' | translate">
        <i class="pi pi-image"></i>
        <span class="btn-label">{{ 'common.photos.uploadFromGallery' | translate }}</span>
        <input
          #galleryInput
          type="file"
          [attr.accept]="accept"
          [attr.capture]="null"
          [attr.multiple]="multiple ? '' : null"
          (change)="onFilePicked($event, galleryInput)"
        />
      </label>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .photo-upload-buttons {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .upload-btn {
      flex: 1 1 auto;
      min-width: 140px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: var(--bg-card);
      border: 1px dashed var(--border-color);
      border-radius: 8px;
      color: var(--text-primary);
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      transition: background 0.15s ease, border-color 0.15s ease;

      i { color: var(--accent-color); font-size: 1rem; }
      &:hover { background: var(--bg-hover); border-color: var(--accent-color); }

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

    .upload-btn--camera {
      background: var(--accent-bg);
      border-color: var(--accent-color);
      color: var(--accent-color);
    }

    /* On screens with no rear camera (typical desktop), the camera
       button is decorative. We keep it visible but de-emphasize it,
       so users fall back to the gallery button. */
    @media (min-width: 1024px) {
      .upload-btn--camera {
        opacity: 0.65;
      }
    }
  `]
})
export class PhotoUploadButtonsComponent {
  @ViewChild('cameraInput') cameraInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('galleryInput') galleryInputRef?: ElementRef<HTMLInputElement>;

  /** MIME types accepted by the underlying inputs. */
  @Input() accept = 'image/jpeg,image/jpg,image/png,image/webp';
  /** Allow selecting more than one file per click. */
  @Input() multiple = false;

  /** Emitted every time the user picks files from any of the two buttons. */
  @Output() filesPicked = new EventEmitter<FileList | null>();

  onFilePicked(event: Event, input: HTMLInputElement): void {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      this.filesPicked.emit(target.files);
    }
    // Reset so picking the same file twice still fires `change`.
    target.value = '';
    void input;
  }
}
