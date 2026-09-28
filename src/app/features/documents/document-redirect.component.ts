import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { environment } from '@env/environment';
import { FUNCTIONS_REGION } from '@core/config/functions-region.config';

/**
 * Safety net for the short document links (`/d/:id`).
 *
 * These URLs are meant never to reach Angular: Firebase Hosting rewrites
 * `/d/**` to the `documentLink` function, which streams the PDF. But if that
 * rewrite is missing — it needs its own `npm run deploy:dev:hosting`, and
 * it has already been forgotten once — the catch-all rewrite serves the SPA
 * instead, the router finds no match, and the customer lands on the **login
 * screen**.
 *
 * That is the worst possible outcome: a customer asked to sign in to see their
 * own quote. Login is for agency staff, never for the end customer. So the
 * route exists, is public, and forwards straight to the function.
 *
 * The redirect costs an extra hop, which is why the Hosting rewrite is still
 * the path we want. This is the parachute, not the plan.
 */
@Component({
  selector: 'app-document-redirect',
  standalone: true,
  template: `
    <div class="redirect">
      <i class="pi pi-spin pi-spinner"></i>
      <p>{{ message }}</p>
    </div>
  `,
  styles: [
    `
      .redirect {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        min-height: 100vh;
        padding: 2rem;
        text-align: center;
        color: var(--text-secondary);
        background: var(--bg-main);
      }

      i {
        font-size: 1.75rem;
        color: var(--accent-color);
      }
    `
  ]
})
export class DocumentRedirectComponent {
  private route = inject(ActivatedRoute);

  /** Deliberately not translated: we redirect before it can be read. */
  message = 'Abriendo documento…';

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.message = 'Documento no encontrado';
      return;
    }
    // `replace` so the back button returns to WhatsApp, not to this page.
    window.location.replace(documentFunctionUrl(id));
  }
}

/**
 * Direct URL of the `documentLink` function.
 *
 * Gen-2 function hostnames are `{region}-{project}`, not `{project}-{region}`.
 * Getting that backwards points at a host that does not resolve — the same
 * mistake that once silently broke the Redsys webhook.
 *
 * ⚠️ **La región se importa de `FUNCTIONS_REGION`; estuvo escrita a mano como
 * `us-central1` y llevaba un mes muerta.** Las functions se mudaron a
 * `europe-west1` el 28 de agosto de 2026 y esta línea se quedó atrás: medido
 * el 26 de septiembre contra producción, `us-central1-…` devuelve el 404 de
 * Google en HTML y `europe-west1-…` sí contesta la function.
 *
 * Lo que lo hacía invisible es lo que hace invisible a todo paracaídas: **solo
 * se usa cuando algo ya ha fallado antes**. CLAUDE.md dice que esta ruta es la
 * red para un rewrite `/d/**` olvidado —convierte el problema en un salto extra
 * en vez de una pantalla de login—, y no lo era: el cliente acababa en un 404
 * de Google al abrir su presupuesto, que es peor que la pantalla que esto venía
 * a evitar.
 *
 * ⚠️ **Y CLAUDE.md avisa de que la región vive en TRES sitios que hay que
 * mover a la vez.** Este era un cuarto, escrito a mano y sin que nadie lo
 * supiera. Importándola deja de poder quedarse atrás: si algún día se vuelve a
 * mudar, esta línea se entera sola.
 */
export function documentFunctionUrl(id: string): string {
  return `https://${FUNCTIONS_REGION}-${environment.firebase.projectId}.cloudfunctions.net/documentLink/${encodeURIComponent(id)}`;
}
