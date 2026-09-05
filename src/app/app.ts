import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationsComponent } from '@shared/components/notifications/notifications.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NotificationsComponent],
  // La pila de avisos vive aquí y no en el layout privado: las pantallas
  // públicas —firma, pago, verificación— también pueden fallar, y tener dos
  // pilas acabaría dando dos comportamientos distintos.
  template: `
    <router-outlet />
    <app-notifications />
  `
})
export class App {}
