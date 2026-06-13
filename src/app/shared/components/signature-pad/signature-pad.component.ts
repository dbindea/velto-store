import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  Output,
  EventEmitter,
  Input,
  OnDestroy,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Touch + mouse signature pad.
 *
 * Pure canvas implementation - no extra dependency.
 * Renders the signature on a transparent background and can export
 * it as a PNG base64 data URL.
 *
 * The component is mobile-first: it uses Pointer Events for unified
 * touch/mouse/pen input, hi-DPI scaling for crisp lines, and resizes
 * the canvas to its container width.
 */
@Component({
  selector: 'app-signature-pad',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="signature-pad">
      <canvas
        #canvas
        class="signature-canvas"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
        (pointerleave)="onPointerUp($event)"
      ></canvas>
      <div class="signature-hint">{{ hint }}</div>
      <div class="signature-actions">
        <button type="button" class="btn-clear" (click)="clear()" [disabled]="isEmpty">
          <i class="pi pi-eraser"></i>
          {{ clearLabel }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .signature-pad {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .signature-canvas {
      display: block;
      width: 100%;
      height: 180px;
      background: #ffffff;
      border: 2px dashed var(--border-color);
      border-radius: 8px;
      touch-action: none;
      cursor: crosshair;
    }

    .signature-hint {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-align: center;
    }

    .signature-actions {
      display: flex;
      justify-content: flex-end;
    }

    .btn-clear {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 0.85rem;
      background: var(--bg-card);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      font-size: 0.8rem;
      cursor: pointer;

      &:hover:not(:disabled) { background: var(--bg-hover); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
  `]
})
export class SignaturePadComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  /** Hint text shown below the canvas. */
  @Input() hint = 'Firma con el dedo o el ratón';
  /** Label for the clear button. */
  @Input() clearLabel = 'Limpiar';

  /** Emits the latest empty/non-empty state. */
  @Output() emptyChange = new EventEmitter<boolean>();
  /** Emits a base64 PNG when the user finishes a stroke. */
  @Output() signatureChange = new EventEmitter<string | null>();

  private ctx!: CanvasRenderingContext2D;
  private drawing = false;
  private hasContent = false;
  isEmpty = true;

  private dpr = 1;
  private resizeObserver?: ResizeObserver;

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.resizeCanvas();

    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(canvas);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.resizeCanvas();
  }

  // ============================================================
  // Pointer handling
  // ============================================================

  onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    this.drawing = true;
    const { x, y } = this.toCanvasPoint(event);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    try {
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      /* noop */
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.drawing) return;
    event.preventDefault();
    const { x, y } = this.toCanvasPoint(event);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();

    if (!this.hasContent) {
      this.hasContent = true;
      this.isEmpty = false;
      this.emptyChange.emit(false);
      this.signatureChange.emit(this.toPng());
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.ctx.closePath();
    try {
      (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      /* noop */
    }
    this.signatureChange.emit(this.toPng());
  }

  // ============================================================
  // Public API
  // ============================================================

  clear(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.hasContent = false;
    this.isEmpty = true;
    this.emptyChange.emit(true);
    this.signatureChange.emit(null);
  }

  /** Returns the current signature as a PNG base64 data URL. */
  toPng(): string {
    return this.canvasRef.nativeElement.toDataURL('image/png');
  }

  // ============================================================
  // Internal
  // ============================================================

  private toCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * this.dpr,
      y: (event.clientY - rect.top) * this.dpr
    };
  }

  private resizeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    // Save current content
    const data = this.hasContent ? canvas.toDataURL() : null;

    canvas.width = rect.width * this.dpr;
    canvas.height = rect.height * this.dpr;

    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#0a0a0a';
    this.ctx.lineWidth = 2.2 * this.dpr;

    if (data) {
      const img = new Image();
      img.onload = () => this.ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = data;
    }
  }
}
