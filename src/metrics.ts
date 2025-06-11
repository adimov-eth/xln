import type { ServerConfig } from './config.ts';
import { events } from './events.ts';
import { logger } from './logger.ts';

export interface Metrics {
  blocksProcessed: number;
  blocksFailed: number;
  entitiesUpdated: number;
  uptime: number;
  startTime: number;
}

class MetricsCollector {
  private metrics: Metrics = {
    blocksProcessed: 0,
    blocksFailed: 0,
    entitiesUpdated: 0,
    uptime: 0,
    startTime: Date.now(),
  };

  constructor() {
    // Subscribe to events
    events.on('block:processed', () => {
      this.metrics.blocksProcessed++;
    });

    events.on('block:failed', () => {
      this.metrics.blocksFailed++;
    });

    events.on('entity:updated', () => {
      this.metrics.entitiesUpdated++;
    });
  }

  getMetrics(): Metrics {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime,
    };
  }

  // Prometheus-style text format
  getPrometheusFormat(): string {
    const m = this.getMetrics();
    return [
      `# HELP xln_blocks_processed_total Total blocks processed`,
      `# TYPE xln_blocks_processed_total counter`,
      `xln_blocks_processed_total ${m.blocksProcessed}`,
      ``,
      `# HELP xln_blocks_failed_total Total blocks that failed processing`,
      `# TYPE xln_blocks_failed_total counter`, 
      `xln_blocks_failed_total ${m.blocksFailed}`,
      ``,
      `# HELP xln_entities_updated_total Total entity updates`,
      `# TYPE xln_entities_updated_total counter`,
      `xln_entities_updated_total ${m.entitiesUpdated}`,
      ``,
      `# HELP xln_uptime_seconds Server uptime in seconds`,
      `# TYPE xln_uptime_seconds gauge`,
      `xln_uptime_seconds ${Math.floor(m.uptime / 1000)}`,
    ].join('\n');
  }
}

export const metricsCollector = new MetricsCollector();

export const startMetricsServer = (config: ServerConfig): void => {
  if (!config.features.metrics) return;

  const server = Bun.serve({
    port: 3001,
    fetch(req) {
      const url = new URL(req.url);
      
      if (url.pathname === '/metrics') {
        return new Response(metricsCollector.getPrometheusFormat(), {
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', ...metricsCollector.getMetrics() }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      return new Response('Not Found', { status: 404 });
    },
  });

  logger.info('Metrics', `HTTP server started on http://localhost:${server.port}`);
}; 