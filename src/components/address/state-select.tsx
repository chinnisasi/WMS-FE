// Story 4-1a — `StateSelect` moved to `components/shared/` so the portal's
// Place-an-order form can reach it across the portal boundary
// (`lib/portal-boundary.test.ts`); this re-export keeps every operator import.
export { StateSelect } from '@/components/shared/state-select';
