import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { ReportsService, ReportsSnapshot } from '@core/reports/reports.service';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss'
})
export class ReportsComponent implements OnInit {
  private reportsService = inject(ReportsService);
  private router = inject(Router);

  snapshot = signal<ReportsSnapshot | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  // Range selector.
  rangeOptions: Array<{ value: '1m' | '3m' | '6m' | '12m'; label: string }> = [
    { value: '1m', label: 'reports.range.1m' },
    { value: '3m', label: 'reports.range.3m' },
    { value: '6m', label: 'reports.range.6m' },
    { value: '12m', label: 'reports.range.12m' }
  ];
  selectedRange = signal<'1m' | '3m' | '6m' | '12m'>('6m');

  ngOnInit(): void {
    this.refresh();
  }

  setRange(value: '1m' | '3m' | '6m' | '12m'): void {
    this.selectedRange.set(value);
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    const months = parseInt(this.selectedRange().replace('m', ''), 10);
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
    this.reportsService.compute(start, end).subscribe({
      next: (snap) => {
        this.snapshot.set(snap);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Reports load error:', err);
        this.error.set('common.error');
        this.loading.set(false);
      }
    });
  }

  // ---- Computed helpers for the template ----

  totalRevenue(): number {
    return (this.snapshot()?.monthlyRevenue || []).reduce((s, p) => s + p.revenue, 0);
  }

  maxMonthlyRevenue(): number {
    return Math.max(1, ...(this.snapshot()?.monthlyRevenue || []).map((p) => p.revenue));
  }

  barHeightPct(revenue: number): number {
    return Math.max(2, Math.round((revenue / this.maxMonthlyRevenue()) * 100));
  }

  monthLabel(date: Date): string {
    const locale =
      typeof document !== 'undefined' ? document.documentElement.lang : 'es';
    return date.toLocaleDateString(locale, { month: 'short', year: '2-digit' });
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat(
      typeof document !== 'undefined' ? document.documentElement.lang : 'es',
      { style: 'currency', currency: 'EUR' }
    ).format(amount);
  }

  goToReservation(id: string): void {
    this.router.navigate(['/reservations', id]);
  }
}
