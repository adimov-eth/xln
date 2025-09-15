#!/usr/bin/env bun

/**
 * Health check script for Docker container
 */

const HEALTH_URL = 'http://localhost:9090/health';
const TIMEOUT = 3000;

async function checkHealth(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);

    const response = await fetch(HEALTH_URL, {
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`Health check failed: HTTP ${response.status}`);
      process.exit(1);
    }

    const health = await response.json();

    if (health.healthStatus === 'unhealthy') {
      console.error('Health check failed: System unhealthy');
      process.exit(1);
    }

    console.log(`Health check passed: ${health.healthStatus}`);
    process.exit(0);
  } catch (error) {
    console.error('Health check failed:', error);
    process.exit(1);
  }
}

checkHealth();