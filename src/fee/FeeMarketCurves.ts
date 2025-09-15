/**
 * Alternative fee curve implementations for congestion pricing
 *
 * These functions provide different approaches to pricing congestion:
 * - Sigmoid (tanh): Smooth S-curve with natural plateau
 * - Logarithmic: Gradual increase, never truly plateaus
 * - Piecewise Linear: Simple, predictable steps
 * - Exponential (bounded): Aggressive but capped growth
 */

export interface CurveConfig {
  threshold: number;      // Utilization level where congestion pricing starts
  maxMultiplier: number;  // Maximum fee multiplier
  aggressiveness: number; // How quickly fees increase (curve-specific meaning)
}

/**
 * Sigmoid curve using tanh - smooth S-curve that naturally plateaus
 * Good for: Predictable fee increases with natural upper bound
 */
export function sigmoidCongestion(
  utilization: number,
  config: CurveConfig
): number {
  // Handle edge cases
  if (!isFinite(utilization) || isNaN(utilization)) {
    return 1.0;
  }
  if (utilization < 0) {
    return 1.0;
  }
  if (utilization < config.threshold) {
    return 1.0;
  }

  const excess = Math.min(utilization - config.threshold, 1 - config.threshold);
  const normalized = excess / (1 - config.threshold);
  const tanhInput = normalized * config.aggressiveness;
  const smoothed = Math.tanh(tanhInput);

  return 1 + smoothed * (config.maxMultiplier - 1);
}

/**
 * Logarithmic curve - gradual increase that slows but never stops
 * Good for: Gentle fee increases that respond to extreme congestion
 */
export function logarithmicCongestion(
  utilization: number,
  config: CurveConfig
): number {
  // Handle edge cases
  if (!isFinite(utilization) || isNaN(utilization)) {
    return 1.0;
  }
  if (utilization < 0) {
    return 1.0;
  }
  if (utilization < config.threshold) {
    return 1.0;
  }

  const excess = Math.min(utilization - config.threshold, 1 - config.threshold);
  const normalized = excess / (1 - config.threshold);

  // log(1 + x) ranges from 0 to log(2) for x in [0, 1]
  // Scale by aggressiveness and map to multiplier range
  const logValue = Math.log(1 + normalized * config.aggressiveness);
  const maxLogValue = Math.log(1 + config.aggressiveness);
  const scaled = logValue / maxLogValue;

  return Math.min(
    1 + scaled * (config.maxMultiplier - 1),
    config.maxMultiplier
  );
}

/**
 * Piecewise linear - simple step function
 * Good for: Transparent, predictable fee tiers
 */
export function piecewiseLinearCongestion(
  utilization: number,
  config: CurveConfig
): number {
  if (utilization < config.threshold) {
    return 1.0;
  }

  // Define tier boundaries
  const tiers = [
    { threshold: 0.7, multiplier: 1.0 },
    { threshold: 0.8, multiplier: 2.0 },
    { threshold: 0.85, multiplier: 3.0 },
    { threshold: 0.9, multiplier: 5.0 },
    { threshold: 0.95, multiplier: 7.0 },
    { threshold: 1.0, multiplier: config.maxMultiplier }
  ];

  for (const tier of tiers) {
    if (utilization <= tier.threshold) {
      return tier.multiplier;
    }
  }

  return config.maxMultiplier;
}

/**
 * Bounded exponential - aggressive growth with hard cap
 * Good for: Strong congestion deterrent
 */
export function boundedExponentialCongestion(
  utilization: number,
  config: CurveConfig
): number {
  if (utilization < config.threshold) {
    return 1.0;
  }

  const excess = Math.min(utilization - config.threshold, 1 - config.threshold);
  const normalized = excess / (1 - config.threshold);

  // Use exp(x) - 1 for exponential growth
  // Scale input by aggressiveness
  const expInput = normalized * config.aggressiveness;
  const expValue = Math.exp(expInput) - 1;
  const maxExpValue = Math.exp(config.aggressiveness) - 1;
  const scaled = expValue / maxExpValue;

  return Math.min(
    1 + scaled * (config.maxMultiplier - 1),
    config.maxMultiplier
  );
}

/**
 * Hybrid curve - combines logarithmic start with sigmoid end
 * Good for: Balanced response across all utilization levels
 */
export function hybridCongestion(
  utilization: number,
  config: CurveConfig
): number {
  if (utilization < config.threshold) {
    return 1.0;
  }

  const excess = Math.min(utilization - config.threshold, 1 - config.threshold);
  const normalized = excess / (1 - config.threshold);

  // Use logarithmic for first half, sigmoid for second half
  if (normalized < 0.5) {
    // Logarithmic phase
    const logValue = Math.log(1 + normalized * 2 * config.aggressiveness);
    const maxLogValue = Math.log(1 + config.aggressiveness);
    const scaled = logValue / maxLogValue * 0.5;
    return 1 + scaled * (config.maxMultiplier - 1);
  } else {
    // Sigmoid phase
    const sigmoidInput = (normalized - 0.5) * 2; // Normalize to [0, 1]
    const tanhInput = sigmoidInput * config.aggressiveness;
    const smoothed = 0.5 + Math.tanh(tanhInput) * 0.5;
    return 1 + smoothed * (config.maxMultiplier - 1);
  }
}

/**
 * Compare all curves at a given utilization
 */
export function compareCurves(
  utilization: number,
  config: CurveConfig = {
    threshold: 0.7,
    maxMultiplier: 10,
    aggressiveness: 3
  }
): Record<string, number> {
  return {
    sigmoid: sigmoidCongestion(utilization, config),
    logarithmic: logarithmicCongestion(utilization, config),
    piecewiseLinear: piecewiseLinearCongestion(utilization, config),
    boundedExponential: boundedExponentialCongestion(utilization, config),
    hybrid: hybridCongestion(utilization, config)
  };
}

/**
 * Generate curve data for visualization
 */
export function generateCurveData(
  config: CurveConfig = {
    threshold: 0.7,
    maxMultiplier: 10,
    aggressiveness: 3
  }
): Array<{
  utilization: number;
  sigmoid: number;
  logarithmic: number;
  piecewiseLinear: number;
  boundedExponential: number;
  hybrid: number;
}> {
  const data = [];

  for (let u = 0; u <= 100; u += 5) {
    const utilization = u / 100;
    data.push({
      utilization,
      ...compareCurves(utilization, config)
    });
  }

  return data;
}

/**
 * Test edge cases for all curves
 */
export function testCurveEdgeCases(): void {
  const config: CurveConfig = {
    threshold: 0.7,
    maxMultiplier: 10,
    aggressiveness: 3
  };

  const testCases = [
    { utilization: 0, expected: 1.0, description: "Zero utilization" },
    { utilization: 0.5, expected: 1.0, description: "Below threshold" },
    { utilization: 0.7, expected: 1.0, description: "At threshold" },
    { utilization: 0.85, expectedMin: 1.0, expectedMax: 10, description: "Mid congestion" },
    { utilization: 1.0, expectedMin: 1.0, expectedMax: 10, description: "Full congestion" },
    { utilization: 1.5, expectedMin: 1.0, expectedMax: 10, description: "Over 100% (edge case)" },
    { utilization: -0.1, expected: 1.0, description: "Negative (edge case)" }
  ];

  const curves = [
    { name: 'sigmoid', fn: sigmoidCongestion },
    { name: 'logarithmic', fn: logarithmicCongestion },
    { name: 'piecewiseLinear', fn: piecewiseLinearCongestion },
    { name: 'boundedExponential', fn: boundedExponentialCongestion },
    { name: 'hybrid', fn: hybridCongestion }
  ];

  console.log("Fee Curve Edge Case Tests:\n");

  for (const testCase of testCases) {
    console.log(`\n${testCase.description} (utilization: ${testCase.utilization}):`);

    for (const curve of curves) {
      const result = curve.fn(testCase.utilization, config);

      // Check if result is valid
      const isValid =
        !isNaN(result) &&
        isFinite(result) &&
        result >= 1.0 &&
        result <= config.maxMultiplier;

      // Check expected values
      let passes = isValid;
      if ('expected' in testCase) {
        passes = passes && Math.abs(result - testCase.expected) < 0.01;
      } else if ('expectedMin' in testCase && 'expectedMax' in testCase) {
        passes = passes && result >= testCase.expectedMin && result <= testCase.expectedMax;
      }

      console.log(`  ${curve.name}: ${result.toFixed(2)} ${passes ? '✓' : '✗'}`);
    }
  }
}

/**
 * Performance test - ensure curves are fast enough for production
 */
export function performanceTest(): void {
  const config: CurveConfig = {
    threshold: 0.7,
    maxMultiplier: 10,
    aggressiveness: 3
  };

  const iterations = 100000;
  const curves = [
    { name: 'sigmoid', fn: sigmoidCongestion },
    { name: 'logarithmic', fn: logarithmicCongestion },
    { name: 'piecewiseLinear', fn: piecewiseLinearCongestion },
    { name: 'boundedExponential', fn: boundedExponentialCongestion },
    { name: 'hybrid', fn: hybridCongestion }
  ];

  console.log(`\nPerformance Test (${iterations} iterations):\n`);

  for (const curve of curves) {
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const utilization = Math.random();
      curve.fn(utilization, config);
    }

    const elapsed = performance.now() - start;
    const opsPerSec = (iterations / elapsed * 1000).toFixed(0);

    console.log(`  ${curve.name}: ${elapsed.toFixed(2)}ms (${opsPerSec} ops/sec)`);
  }
}