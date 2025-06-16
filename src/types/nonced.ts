/**
 * Interface for state objects that track nonce for replay protection
 */
export interface Nonced {
    readonly nonce: number;
}

/**
 * Type guard to check if a state object is nonced
 */
export function isNonced(state: unknown): state is Nonced {
    return (
        typeof state === 'object' &&
        state !== null &&
        'nonce' in state &&
        typeof (state as any).nonce === 'number' &&
        Number.isSafeInteger((state as any).nonce)
    );
}