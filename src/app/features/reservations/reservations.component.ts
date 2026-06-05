import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

@Component({
  selector: 'app-reservations',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="page">
      <h1>{{ 'menu.reservations' | translate }}</h1>
      <div class="card">
        <p class="muted">{{ 'common.moduleInProgress' | translate }}</p>
      </div>
    </div>
  `,
  styles: [`
    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0 0 1.5rem;
    }
    .card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 3rem;
      border: 1px solid var(--border-color);
      text-align: center;
    }
    .muted {
      color: var(--text-muted);
      margin: 0;
    }
  `]
})
export class ReservationsComponent {}
