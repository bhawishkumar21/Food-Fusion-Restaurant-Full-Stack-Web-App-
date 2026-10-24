import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Which workflow a dispatch targets; each maps to its own env var. */
export type N8nWorkflow = 'feedback' | 'order';

const URL_ENV: Record<N8nWorkflow, string> = {
  feedback: 'N8N_FEEDBACK_WEBHOOK_URL',
  order: 'N8N_ORDER_WEBHOOK_URL',
};

// Workflows that respond after their last node (AI scoring, email) can take a while.
const TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1_500;

/**
 * Fire-and-forget POSTs to n8n webhooks. Retries only when the request
 * provably never reached the workflow (connection errors, 502-504). Never
 * throws: a slow or broken workflow must not fail the customer's request, but
 * every failure is logged with enough detail (status, n8n's message) to fix it.
 */
@Injectable()
export class N8nService {
  private readonly logger = new Logger(N8nService.name);

  constructor(private readonly config: ConfigService) {
    for (const [workflow, env] of Object.entries(URL_ENV)) {
      const url = this.config.get<string>(env)?.trim();
      if (!url) {
        this.logger.warn(`${env} is not set — ${workflow} notifications are disabled.`);
      } else if (url.includes('/webhook-test/')) {
        this.logger.warn(
          `${env} uses an n8n /webhook-test/ URL, which only accepts one call after "Execute workflow" is clicked. Use the production /webhook/ URL with the workflow activated.`,
        );
      }
    }
  }

  /** Schedules the dispatch without awaiting it. */
  dispatch(workflow: N8nWorkflow, event: string, payload: Record<string, unknown>) {
    void this.send(workflow, event, payload);
  }

  /** Resolves true when n8n accepted the payload (2xx). */
  async send(workflow: N8nWorkflow, event: string, payload: Record<string, unknown>): Promise<boolean> {
    const env = URL_ENV[workflow];
    const url = this.config.get<string>(env)?.trim();
    if (!url) {
      this.logger.warn(`Skipping ${event}: ${env} is not set.`);
      return false;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const secret = this.config.get<string>('N8N_WEBHOOK_SECRET')?.trim();
    if (secret) {
      headers['x-webhook-secret'] = secret;
      headers['X-N8N-Secret'] = secret;
    }
    const body = JSON.stringify({ event, ...payload });

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) {
          this.logger.log(`${event} → n8n ${res.status} (${describe(url)})`);
          return true;
        }
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        this.logger.error(`${event} → n8n responded ${res.status} (${describe(url)}): ${detail}`);
        // n8n answered, so the workflow already ran (or was refused): a retry
        // would only send the customer a second email. 502/503/504 come from
        // n8n's gateway before the workflow starts, so those are safe to retry.
        if (![502, 503, 504].includes(res.status)) return false;
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
          // n8n may still be running the workflow; retrying risks duplicates.
          this.logger.error(`${event} → n8n did not answer within ${TIMEOUT_MS}ms (${describe(url)}); not retrying, check n8n Executions.`);
          return false;
        }
        const reason =
          err instanceof Error
            ? `${err.message}${err.cause ? ` (${String((err.cause as Error).message ?? err.cause)})` : ''}`
            : String(err);
        this.logger.error(`${event} → n8n request failed, attempt ${attempt}/2 (${describe(url)}): ${reason}`);
      }
      if (attempt === 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    return false;
  }
}

/** Host + path for logs, never query strings. */
function describe(url: string) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return 'invalid URL';
  }
}
