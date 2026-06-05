import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FirebaseStatusService } from '../core/services/firebase-status.service';

interface FirebaseStatus {
  firebaseInitialized: boolean;
  authConfigured: boolean;
  firestoreConfigured: boolean;
  storageConfigured: boolean;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white flex items-center justify-center p-8"
    >
      <div class="max-w-2xl w-full">
        <div class="text-center mb-12">
          <h1
            class="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent"
          >
            Velto Store Base App
          </h1>
          <p class="text-slate-400 text-lg">Gestión de flota de vehículos</p>
        </div>

        <div class="bg-slate-800/50 backdrop-blur rounded-2xl p-8 border border-slate-700">
          <h2 class="text-2xl font-semibold mb-6 text-center">Estado de la Configuración</h2>

          <div class="space-y-4">
            <div class="flex items-center gap-4 p-4 bg-slate-700/50 rounded-xl">
              <div
                class="w-3 h-3 rounded-full"
                [class.bg-green-500]="status.firebaseInitialized"
                [class.bg-red-500]="!status.firebaseInitialized"
              ></div>
              <span class="text-lg">Angular OK</span>
            </div>

            <div class="flex items-center gap-4 p-4 bg-slate-700/50 rounded-xl">
              <div
                class="w-3 h-3 rounded-full"
                [class.bg-green-500]="status.firebaseInitialized"
                [class.bg-red-500]="!status.firebaseInitialized"
              ></div>
              <span class="text-lg">Firebase config loaded</span>
            </div>

            <div class="flex items-center gap-4 p-4 bg-slate-700/50 rounded-xl">
              <div
                class="w-3 h-3 rounded-full"
                [class.bg-green-500]="status.firestoreConfigured"
                [class.bg-red-500]="!status.firestoreConfigured"
              ></div>
              <span class="text-lg">Ready for Firestore</span>
            </div>

            <div class="flex items-center gap-4 p-4 bg-slate-700/50 rounded-xl">
              <div
                class="w-3 h-3 rounded-full"
                [class.bg-green-500]="status.authConfigured"
                [class.bg-red-500]="!status.authConfigured"
              ></div>
              <span class="text-lg">Auth preparado</span>
            </div>

            <div class="flex items-center gap-4 p-4 bg-slate-700/50 rounded-xl">
              <div
                class="w-3 h-3 rounded-full"
                [class.bg-green-500]="status.storageConfigured"
                [class.bg-red-500]="!status.storageConfigured"
              ></div>
              <span class="text-lg">Storage preparado</span>
            </div>
          </div>

          <div class="mt-8 pt-6 border-t border-slate-600 text-center text-slate-400">
            <p>Proyecto base preparado. Solicita los módulos adicionales para continuar.</p>
          </div>
        </div>

        <div class="mt-8 text-center text-slate-500 text-sm">velto-store v1.0.0</div>
      </div>
    </div>
  `,
})
export class HomeComponent implements OnInit {
  private firebaseStatus = inject(FirebaseStatusService);
  status: FirebaseStatus = {
    firebaseInitialized: false,
    authConfigured: false,
    firestoreConfigured: false,
    storageConfigured: false,
  };

  ngOnInit() {
    this.status = this.firebaseStatus.status;
  }
}
