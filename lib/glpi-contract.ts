/**
 * Wire contract shared by the Next route and the browser recovery state
 * machine. Every failed creation/recovery response carries these four fields;
 * absence or an unknown value is fail-closed (preserve the operation).
 */
export const GLPI_TERMINAL_ERROR_CODES = Object.freeze([
  'CREATION_REJECTED',
  'DISTINCT_REQUIRED',
  'INTENT_CONSUMED',
  'INTENT_ABANDONED',
] as const);

export type GlpiTerminalErrorCode = typeof GLPI_TERMINAL_ERROR_CODES[number];

export type GlpiErrorContract = {
  code: string;
  terminal: boolean;
  retryable: boolean;
  preserveOperation: boolean;
};

export function isTerminalGlpiFailure(value: Partial<GlpiErrorContract> & { intent_consumed?: boolean }, capabilityAttached = false) {
  return value.terminal === true
    && value.retryable === false
    && value.preserveOperation === false
    && (GLPI_TERMINAL_ERROR_CODES as readonly string[]).includes(value.code || '')
    && (!capabilityAttached || value.intent_consumed === true);
}
