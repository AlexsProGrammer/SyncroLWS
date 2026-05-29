export { AnalyticsDashboardView } from './AnalyticsDashboard';

/** Module init — no subscriptions needed; analytics uses its own sandbox tables. */
export function init(): void {
  console.log('[module:analytics] initialised');
}
