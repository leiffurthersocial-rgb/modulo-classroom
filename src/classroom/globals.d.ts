// Test/debug hooks the app publishes on window (screenshot mode, benchmark, e2e).
export {};

declare global {
  interface Window {
    __shotReady?: boolean;
    __info?: Record<string, unknown>;
    __bench?: Record<string, unknown>;
  }
}
