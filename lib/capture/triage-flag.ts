/** Gate for the two-phase tiered-ingestion flow. Off by default; '1' enables.
 *  Matches the strict-'1' convention of COURSECAPTURE_V2_INGESTION. */
export function isTriageEnabled(): boolean {
  return process.env.COURSECAPTURE_TRIAGE === '1';
}
