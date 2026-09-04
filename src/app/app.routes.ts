import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { publicGuard } from './core/guards/public.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent),
    canActivate: [publicGuard]
  },
  {
    path: 'sign-contract/:token',
    loadComponent: () => import('./features/contracts/pages/sign-contract/sign-contract.component').then(m => m.SignContractComponent)
  },
  /**
   * Customer-facing document links. PUBLIC on purpose — a customer must never
   * be asked to log in to read their own quote.
   *
   * Normally Hosting rewrites `/d/**` to the `documentLink` function and this
   * route is never reached. It exists so that a missing rewrite degrades into
   * an extra redirect instead of a login screen.
   */
  {
    path: 'd/:id',
    loadComponent: () => import('./features/documents/document-redirect.component').then(m => m.DocumentRedirectComponent)
  },
  /**
   * Pago desde el móvil del cliente. PÚBLICA, y va **antes** del bloque con
   * `authGuard` para que el router la resuelva primero: pedirle a un cliente
   * que inicie sesión para pagar es pedirle que no pague.
   *
   * El id del pago es el secreto, como en `/d/…`. La function que hay detrás
   * devuelve solo importe, concepto y marca.
   */
  /**
   * Verificación de un contrato desde su QR o su código impreso (N-9). PÚBLICA
   * y **antes** del bloque con `authGuard`: quien escanea el QR de un contrato
   * en papel no tiene cuenta ni tiene por qué tenerla.
   *
   * La ruta sin código sirve para teclearlo a mano, que es la salida de quien
   * lo copia mal de un papel.
   *
   * ⚠️ La function que hay detrás devuelve cinco datos y **ningún dato
   * personal**: un contrato olvidado en un mostrador no puede convertirse en la
   * ficha de nadie.
   */
  {
    path: 'v',
    loadComponent: () => import('./features/contracts/pages/contract-verify/contract-verify.component').then(m => m.ContractVerifyComponent)
  },
  {
    path: 'v/:code',
    loadComponent: () => import('./features/contracts/pages/contract-verify/contract-verify.component').then(m => m.ContractVerifyComponent)
  },
  {
    path: 'pay/:paymentId',
    loadComponent: () => import('./features/payments/pages/payment-checkout/payment-checkout.component').then(m => m.PaymentCheckoutComponent)
  },
  {
    path: '',
    loadComponent: () => import('./layout/private-layout/private-layout.component').then(m => m.PrivateLayoutComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'calendar',
        loadComponent: () => import('./features/calendar/calendar.component').then(m => m.CalendarComponent)
      },
      {
        path: 'reservations',
        loadComponent: () => import('./features/reservations/reservations.component').then(m => m.ReservationsComponent),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/reservations/pages/reservation-list/reservation-list.component').then(m => m.ReservationListComponent)
          },
          {
            path: 'new',
            loadComponent: () => import('./features/reservations/pages/reservation-create/reservation-create.component').then(m => m.ReservationCreateComponent)
          },
          {
            path: ':id',
            loadComponent: () => import('./features/reservations/pages/reservation-detail/reservation-detail.component').then(m => m.ReservationDetailComponent)
          }
        ]
      },
      {
        path: 'vehicles',
        loadComponent: () => import('./features/vehicles/vehicles.component').then(m => m.VehiclesComponent),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/vehicles/pages/vehicle-list/vehicle-list.component').then(m => m.VehicleListComponent)
          },
          {
            path: 'new',
            loadComponent: () => import('./features/vehicles/pages/vehicle-form/vehicle-form.component').then(m => m.VehicleFormComponent)
          },
          {
            path: ':id',
            loadComponent: () => import('./features/vehicles/pages/vehicle-detail/vehicle-detail.component').then(m => m.VehicleDetailComponent)
          },
          {
            path: ':id/edit',
            loadComponent: () => import('./features/vehicles/pages/vehicle-form/vehicle-form.component').then(m => m.VehicleFormComponent)
          }
        ]
      },
      {
        path: 'clients',
        loadComponent: () => import('./features/clients/clients.component').then(m => m.ClientsComponent),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/clients/pages/client-list/client-list.component').then(m => m.ClientListComponent)
          },
          {
            path: 'new',
            loadComponent: () => import('./features/clients/pages/client-form/client-form.component').then(m => m.ClientFormComponent)
          },
          {
            path: ':id',
            loadComponent: () => import('./features/clients/pages/client-detail/client-detail.component').then(m => m.ClientDetailComponent)
          },
          {
            path: ':id/edit',
            loadComponent: () => import('./features/clients/pages/client-form/client-form.component').then(m => m.ClientFormComponent)
          }
        ]
      },
      {
        path: 'payments',
        loadComponent: () => import('./features/payments/payments.component').then(m => m.PaymentsComponent),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/payments/pages/payment-list/payment-list.component').then(m => m.PaymentListComponent)
          },
          {
            path: 'new',
            loadComponent: () => import('./features/payments/pages/payment-free/payment-free.component').then(m => m.PaymentFreeComponent)
          },
          {
            path: 'free',
            redirectTo: 'new',
            pathMatch: 'full'
          },
          {
            path: ':id',
            loadComponent: () => import('./features/payments/pages/payment-detail/payment-detail.component').then(m => m.PaymentDetailComponent)
          }
        ]
      },
      {
        path: 'expenses',
        loadComponent: () => import('./features/expenses/expenses.component').then(m => m.ExpensesComponent)
      },
      {
        path: 'contracts',
        loadComponent: () => import('./features/contracts/contracts.component').then(m => m.ContractsComponent),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/contracts/pages/contract-list/contract-list.component').then(m => m.ContractListComponent)
          },
          {
            path: ':id',
            loadComponent: () => import('./features/contracts/pages/contract-detail/contract-detail.component').then(m => m.ContractDetailComponent)
          }
        ]
      },
      {
        path: 'inspections',
        loadComponent: () => import('./features/inspections/inspections.component').then(m => m.InspectionsComponent),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/inspections/pages/inspection-list/inspection-list.component').then(m => m.InspectionListComponent)
          },
          {
            path: 'pickup/:reservationId',
            loadComponent: () => import('./features/inspections/pages/inspection-pickup/inspection-pickup.component').then(m => m.InspectionPickupComponent)
          },
          {
            path: 'return/:reservationId',
            loadComponent: () => import('./features/inspections/pages/inspection-return/inspection-return.component').then(m => m.InspectionReturnComponent)
          },
          {
            path: ':id',
            loadComponent: () => import('./features/inspections/pages/inspection-detail/inspection-detail.component').then(m => m.InspectionDetailComponent)
          }
        ]
      },
      {
        path: 'reports',
        loadComponent: () => import('./features/reports/reports.component').then(m => m.ReportsComponent)
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings.component').then(m => m.SettingsComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];