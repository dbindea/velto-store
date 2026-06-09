import { Component, Input, Output, EventEmitter, HostListener, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

export interface GalleryImage {
  url: string;
  path?: string;
  isMain?: boolean;
  uploadedAt?: any;
  fileName?: string;
}

@Component({
  selector: 'app-image-gallery',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './image-gallery.component.html',
  styleUrl: './image-gallery.component.scss'
})
export class ImageGalleryComponent {
  @Input() images: GalleryImage[] = [];
  @Input() initialIndex = 0;
  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();

  currentIndex = signal(0);

  ngOnChanges(): void {
    if (this.isOpen && this.images.length > 0) {
      this.currentIndex.set(Math.min(this.initialIndex, this.images.length - 1));
    }
  }

  get currentImage(): GalleryImage | null {
    return this.images[this.currentIndex()] || null;
  }

  get counter(): string {
    return `${this.currentIndex() + 1} / ${this.images.length}`;
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.isOpen) return;

    switch (event.key) {
      case 'Escape':
        this.onClose();
        break;
      case 'ArrowLeft':
        this.previous();
        break;
      case 'ArrowRight':
        this.next();
        break;
    }
  }

  onClose(): void {
    this.close.emit();
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('gallery-overlay')) {
      this.onClose();
    }
  }

  previous(): void {
    if (this.currentIndex() > 0) {
      this.currentIndex.update(i => i - 1);
    }
  }

  next(): void {
    if (this.currentIndex() < this.images.length - 1) {
      this.currentIndex.update(i => i + 1);
    }
  }

  goToIndex(index: number): void {
    this.currentIndex.set(index);
  }

  trackByIndex(index: number): number {
    return index;
  }
}