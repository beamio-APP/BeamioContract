/**
 * Logger for API server. Replace with your preferred logger (pino, winston, etc.).
 */
export function logger(...args: unknown[]): void {
	console.log('[Beamio]', ...args)
}
