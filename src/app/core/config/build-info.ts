/**
 * GENERADO por `scripts/write-build-info.js` en cada build. No se edita a mano.
 *
 * Fuera de CI vale `local`, para que compilar no ensucie el árbol de trabajo.
 * En CI lleva el commit real — en `master`, el del merge.
 */
export interface BuildInfo {
  /** El SHA que se compiló, o `local` fuera de CI. */
  commit: string;
  branch: string;
  /** ISO 8601. Vacío fuera de CI. */
  builtAt: string;
}

export const BUILD_INFO: BuildInfo = {
  commit: 'local',
  branch: 'local',
  builtAt: ''
};
