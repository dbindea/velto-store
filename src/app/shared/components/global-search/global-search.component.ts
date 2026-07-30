import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
  ViewChild,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  GlobalSearchHit,
  GlobalSearchResults,
  GlobalSearchService
} from '@core/search/global-search.service';

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './global-search.component.html',
  styleUrl: './global-search.component.scss'
})
export class GlobalSearchComponent {
  @Output() close = new EventEmitter<void>();

  private searchService = inject(GlobalSearchService);
  private router = inject(Router);
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  query = signal('');
  results = signal<GlobalSearchResults | null>(null);
  hits = signal<GlobalSearchHit[]>([]);
  loading = signal(false);
  selectedIndex = signal(0);

  private searchSubject = new Subject<string>();
  private destroyed = false;

  ngOnInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        takeUntil(this._destroy$)
      )
      .subscribe((term) => this.runSearch(term));
    // Defer focus until the overlay is in the DOM.
    setTimeout(() => this.searchInput?.nativeElement?.focus(), 50);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this._destroy$.next();
    this._destroy$.complete();
  }

  private _destroy$ = new Subject<void>();

  onInput(value: string): void {
    this.query.set(value);
    this.selectedIndex.set(0);
    this.searchSubject.next(value);
  }

  private runSearch(term: string): void {
    if (term.trim().length < 2) {
      this.results.set(null);
      this.hits.set([]);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.searchService.search(term).subscribe({
      next: (r) => {
        if (this.destroyed) return;
        this.results.set(r);
        this.hits.set(this.searchService.toHits(r));
        this.loading.set(false);
        this.selectedIndex.set(0);
      },
      error: () => {
        this.loading.set(false);
        this.results.set(null);
        this.hits.set([]);
      }
    });
  }

  navigate(hit: GlobalSearchHit): void {
    this.router.navigateByUrl(hit.route);
    this.close.emit();
  }

  onKeyDown(event: KeyboardEvent): void {
    const list = this.hits();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex.set(Math.min(this.selectedIndex() + 1, Math.max(0, list.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex.set(Math.max(0, this.selectedIndex() - 1));
    } else if (event.key === 'Enter') {
      const hit = list[this.selectedIndex()];
      if (hit) {
        event.preventDefault();
        this.navigate(hit);
      }
    } else if (event.key === 'Escape') {
      this.close.emit();
    }
  }

  iconFor(kind: GlobalSearchHit['kind']): string {
    switch (kind) {
      case 'client':
        return 'pi pi-user';
      case 'vehicle':
        return 'pi pi-car';
      case 'reservation':
        return 'pi pi-book';
    }
  }

  groupLabelFor(kind: GlobalSearchHit['kind']): string {
    switch (kind) {
      case 'client':
        return 'search.groups.clients';
      case 'vehicle':
        return 'search.groups.vehicles';
      case 'reservation':
        return 'search.groups.reservations';
    }
  }

  trackHit(_: number, hit: GlobalSearchHit): string {
    return hit.kind + ':' + hit.id;
  }

  @HostListener('document:keydown', ['$event'])
  onDocKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }
}
