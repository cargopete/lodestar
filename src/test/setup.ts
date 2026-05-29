// Vitest global setup. Registers @testing-library/jest-dom matchers (toBeInTheDocument,
// toHaveTextContent, etc.). Loading this in the node environment is harmless — it only
// extends `expect`; the matchers are exercised by jsdom-environment component tests.
import '@testing-library/jest-dom/vitest';
