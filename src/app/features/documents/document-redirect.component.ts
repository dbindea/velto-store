import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { environment } from '@env/environment';

/**
 * Safety net for the short document links (`/d/:id`).
 *
 * These URLs are meant never to reach Angular: Firebase Hosting rewrites
 * `/d/**` to the `documentLink` function, which streams the PDF. But if that
 * rewrite is missing — it needs its own `firebase deploy --only hosting`, and
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
 */
export function documentFunctionUrl(id: string): string {
  return `https://us-central1-${environment.firebase.projectId}.cloudfunctions.net/documentLink/${encodeURIComponent(id)}`;
}
