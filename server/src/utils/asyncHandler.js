// Wraps async route handlers so thrown errors / rejected promises flow to
// the central Express error handler instead of crashing the process.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
