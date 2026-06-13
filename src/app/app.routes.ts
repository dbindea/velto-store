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