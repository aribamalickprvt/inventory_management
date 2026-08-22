const { trace, context, propagation } = require('@opentelemetry/api');

/**
 * Auto-instrumentation covers HTTP, Express, MySQL2, MongoDB, and ioredis
 * automatically — but it does NOT automatically link a trace across a
 * RabbitMQ message. From the tracer's point of view, "publish a message"
 * and "consume a message" are two completely unrelated operations in two
 * separate processes; nothing connects them unless we do it ourselves.
 *
 * The fix is the standard W3C Trace Context pattern: inject the current
 * trace/span IDs into the message's headers when publishing, then extract
 * them back out when consuming and start the new span as a child of that
 * extracted context. That's what turns "API span" + "Worker span" into ONE
 * connected trace instead of two disconnected ones — the entire point of
 * "tracing requests end-to-end" across services.
 */

/** Call when publishing — returns a headers object to attach to the AMQP message. */
function injectTraceContext(existingHeaders = {}) {
  const headers = { ...existingHeaders };
  propagation.inject(context.active(), headers);
  return headers;
}

/**
 * Call when consuming — wraps `fn` in a new span that is a CHILD of
 * whatever trace context was injected by the publisher, so it shows up
 * nested under the original request in Jaeger rather than as a new,
 * disconnected trace.
 */
async function runInPropagatedContext(tracerName, spanName, messageHeaders, fn) {
  const extractedContext = propagation.extract(context.active(), messageHeaders || {});
  const tracer = trace.getTracer(tracerName);

  return context.with(extractedContext, () =>
    tracer.startActiveSpan(spanName, async (span) => {
      try {
        return await fn(span);
      } catch (err) {
        span.recordException(err);
        throw err;
      } finally {
        span.end();
      }
    })
  );
}

module.exports = { injectTraceContext, runInPropagatedContext };
