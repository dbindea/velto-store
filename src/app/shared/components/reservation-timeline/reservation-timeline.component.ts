import { Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import {
  TimelineStep,
  TimelineStepState,
  getReservationTimelineSteps,
  type WorkflowContext
} from '@shared/utils/reservation-workflow.util';

/**
 * Visual timeline of the 10 logical steps of a reservation.
 *
 * Mobile-first: vertical timeline on phones, horizontal compact
 * timeline on desktop.  Each step shows:
 *   - icon (check / pending / current / blocked / skipped)
 *   - label (translated via `timeline.<key>`)
 *   - optional "advance" button to take the next action
 *   - optional blocked reason
 *
 * Pure presentation: takes a WorkflowContext, never mutates anything.
 */
@Component({
  selector: 'app-reservation-timeline',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './reservation-timeline.component.html',
  styleUrl: './reservation-timeline.component.scss'
})
export class ReservationTimelineComponent {
  private router = inject(Router);

  /** Reservation-detail builds a complete WorkflowContext. */
  @Input({ required: true }) context!: WorkflowContext;

  /** Hide the action buttons (read-only mode for dashboard / print). */
  @Input() readOnly = false;

  private ctxSignal = signal<WorkflowContext | null>(null);

  steps = computed<TimelineStep[]>(() => {
    const ctx = this.ctxSignal();
    if (!ctx) return [];
    return getReservationTimelineSteps(ctx);
  });

  ngOnChanges(): void {
    if (this.context) {
      this.ctxSignal.set(this.context);
    }
  }

  iconFor(state: TimelineStepState): string {
    switch (state) {
      case 'completed':
        return 'pi pi-check-circle';
      case 'current':
        return 'pi pi-spin pi-spinner';
      case 'blocked':
        return 'pi pi-lock';
      case 'skipped_by_exception':
        return 'pi pi-minus-circle';
      case 'pending':
      default:
        return 'pi pi-circle';
    }
  }

  /**
   * Map each step action to a navigation target.  Components reuse
   * the existing buttons (pay initial, generate contract, etc.) but
   * if the user prefers a shortcut from the timeline we provide one
   * too.
   */
  runAction(step: TimelineStep): void {
    const r = this.context?.reservation;
    if (!r || !step.action) return;

    switch (step.action) {
      case 'pay_initial':
        this.router.navigate(['/reservations', r.id], { fragment: 'payments' });
        break;
      case 'generate_contract':
      case 'create_signing_link':
        if (this.context.contract?.id) {
          this.router.navigate(['/contracts', this.context.contract.id]);
        } else {
          this.router.navigate(['/reservations', r.id], { fragment: 'contracts' });
        }
        break;
      case 'pay_remaining':
      case 'pay_deposit':
        this.router.navigate(['/reservations', r.id], { fragment: 'payments' });
        break;
      case 'start_pickup':
        this.router.navigate(['/inspections/pickup', r.id]);
        break;
      case 'start_return':
        this.router.navigate(['/inspections/return', r.id]);
        break;
      case 'settle_deposit':
        this.router.navigate(['/reservations', r.id], { fragment: 'deposit' });
        break;
      case 'close_reservation':
        this.router.navigate(['/reservations', r.id], { fragment: 'actions' });
        break;
    }
  }

  trackStep(_: number, s: TimelineStep): string {
    return s.key;
  }
}
