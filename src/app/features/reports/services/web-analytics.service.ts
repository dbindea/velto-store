import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  getDocs,
  orderBy,
  query,
  where
} from '@angular/fire/firestore';

/**
 * Lo que se guarda de un día de visitas.
 *
 * ⚠️ **Todo opcional menos el día.** Un documento nace con lo primero que pase
 * —una visita de bot a las 3:00 solo trae `bots`— y los contadores se van
 * añadiendo. Darlos por presentes rompería la pantalla el primer día.
 */
export interface DiaDeVisitas {
  date: string;
  visitors?: number;
  pageViews?: number;
  bots?: number;
  routes?: Record<string, number>;
  funnel?: { precios?: number; ficha?: number; cotizacion?: number };
}

export interface ResumenDeVisitas {
  dias: DiaDeVisitas[];
  /**
   * ⚠️ **Esto es la suma de los únicos de cada día, NO personas distintas.**
   * Quien entra el lunes y el martes cuenta dos veces, y tiene que ser así: la
   * sal del hash rota cada día justo para que no se pueda saber que es la misma
   * persona, y esa imposibilidad es lo que permite medir sin pedir
   * consentimiento. La pantalla lo dice con esas palabras.
   */
  visitantesSumados: number;
  paginasVistas: number;
  botsDescartados: number;
  /** Visitas por ruta, sumadas en el periodo y ya ordenadas de más a menos. */
  rutas: { ruta: string; visitas: number }[];
  embudo: { precios: number; ficha: number; cotizacion: number };
}

@Injectable({ providedIn: 'root' })
export class WebAnalyticsService {
  private firestore = inject(Firestore);

  /**
   * Los días del periodo.
   *
   * ⚠️ **Se consulta por el campo `date` y no por el id**, aunque el id sea la
   * fecha. Firestore no sabe comparar ids por rango sin un `orderBy(__name__)`
   * y sus trampas; con el campo dentro, la consulta es la de siempre y el
   * índice es el simple.
   */
  async resumen(desde: Date, hasta: Date): Promise<ResumenDeVisitas> {
    const q = query(
      collection(this.firestore, 'webAnalytics'),
      where('date', '>=', this.clave(desde)),
      where('date', '<=', this.clave(hasta)),
      orderBy('date', 'asc')
    );
    const snap = await getDocs(q);
    const dias = snap.docs.map(d => ({ date: d.id, ...d.data() }) as DiaDeVisitas);

    const rutas = new Map<string, number>();
    const embudo = { precios: 0, ficha: 0, cotizacion: 0 };
    let visitantes = 0;
    let paginas = 0;
    let bots = 0;

    for (const d of dias) {
      visitantes += d.visitors ?? 0;
      paginas += d.pageViews ?? 0;
      bots += d.bots ?? 0;
      for (const [r, n] of Object.entries(d.routes ?? {})) {
        rutas.set(r, (rutas.get(r) ?? 0) + (n ?? 0));
      }
      embudo.precios += d.funnel?.precios ?? 0;
      embudo.ficha += d.funnel?.ficha ?? 0;
      embudo.cotizacion += d.funnel?.cotizacion ?? 0;
    }

    return {
      dias,
      visitantesSumados: visitantes,
      paginasVistas: paginas,
      botsDescartados: bots,
      rutas: [...rutas.entries()]
        .map(([ruta, visitas]) => ({ ruta, visitas }))
        .sort((a, b) => b.visitas - a.visitas),
      embudo
    };
  }

  /**
   * La clave del día, en hora de **Madrid**.
   *
   * ⚠️ **Tiene que coincidir con la que escribe la function**, que también usa
   * Madrid. Calculándola aquí en UTC, el primer y el último día del rango se
   * quedarían fuera o de más según la hora a la que se mire la pantalla — y
   * nadie lo notaría, porque la cifra seguiría pareciendo razonable.
   */
  private clave(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
  }
}
