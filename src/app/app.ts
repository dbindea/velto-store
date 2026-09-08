import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationsComponent } from '@shared/components/notifications/notifications.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NotificationsComponent, ConfirmDialogComponent],
  // La pila de avisos y el diálogo de confirmación viven aquí y no en el layout
  // privado: las pantallas públicas —firma, pago, verificación— también pueden
  // fallar y también preguntan cosas, y tenerlos en dos sitios acabaría dando
  // dos comportamientos distintos.
  template: `
    <router-outlet />
    <app-notifications />
    <app-confirm-dialog />
  `
})
export class App {}
