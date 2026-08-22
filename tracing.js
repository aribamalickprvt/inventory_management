const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

/**
 * IMPORTANT: this file must be required — and start() called — before
 * anything else requires express, mysql2, mongodb, amqplib, or ioredis.
 * OpenTelemetry's auto-instrumentation works by monkey-patching those
 * modules the moment they're first require()'d; if app.js (or anything it
 * pulls in) loads first, the patching happens too late and those calls
 * silently produce no spans. That's why server.js / worker.js /
 * syncWorker.js all call this as literally their first line, before even
 * requiring ./app.
 */
function start(serviceName) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem instrumentation is extremely noisy (every require(),
        // every log write) and adds little value here — turn it off.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = () => {
    sdk.shutdown().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return sdk;
}

module.exports = { start };
