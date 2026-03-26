/**
 * Global Vitest setup.
 *
 * jsdom does not implement HTMLCanvasElement.getContext — stub it so that
 * any test creating a <canvas> and passing it to a mocked detector doesn't
 * throw. Tests that need actual pixel data should mock getContext themselves.
 */

// Stub HTMLCanvasElement.getContext globally before any test runs.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = () => null;
}
