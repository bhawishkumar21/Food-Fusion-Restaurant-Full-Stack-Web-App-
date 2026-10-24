import {
  BadGatewayException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/decorators';
import { MenuService } from '../menu/menu.service';

/**
 * Issues short-lived ElevenLabs signed URLs so the API key never reaches the
 * browser, and seeds the agent with the *current* menu as dynamic variables.
 * Mid-session stock changes are pushed by the client via sendContextualUpdate.
 */
@Controller()
export class VoiceController {
  constructor(
    private readonly config: ConfigService,
    private readonly menu: MenuService,
  ) {}

  @Public()
  @Get('voice/signed-url')
  async signedUrl() {
    const { signedUrl, overrides } = await this.createSignedSession();
    return { signedUrl, overrides };
  }

  @Public()
  @Get('t/:tenantId/voice/session')
  async session(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    const { signedUrl, overrides } = await this.createSignedSession();
    const items = await this.menu.list(tenantId);
    const menuContext = items
      .map(
        (i) =>
          `${i.id} | ${i.name} | PKR ${Math.round(i.price_cents / 100).toLocaleString('en-US')} | ${i.tags.join(',')} | ${i.is_available ? 'AVAILABLE' : 'SOLD OUT'}${i.voice_notes ? ` | ${i.voice_notes}` : ''}`,
      )
      .join('\n');
    return {
      signedUrl,
      dynamicVariables: {
        restaurant_name: 'Food Fusion',
        menu: menuContext,
        language_instruction: 'Reply naturally in the guest’s language. For Urdu or Roman Urdu, use warm Urdu/Roman Urdu with clear dish names and prices; English is also welcome.',
      },
      overrides,
    };
  }

  private async createSignedSession() {
    const agentId = this.config.getOrThrow<string>('ELEVENLABS_AGENT_ID');
    const apiKey = this.config.getOrThrow<string>('ELEVENLABS_API_KEY');
    // The signed URL always binds this exact agent. A per-session voice
    // override is optional; when absent ElevenLabs uses this agent's own
    // configured custom voice—not browser speech synthesis.
    const voiceId = this.config.get<string>('ELEVENLABS_GHALIB_VOICE_ID');
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      {
        headers: {
          'xi-api-key': apiKey,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) throw new BadGatewayException('Voice service unavailable');
    const { signed_url } = (await res.json()) as { signed_url: string };

    return {
      signedUrl: signed_url,
      overrides: this.overrides(voiceId),
    };
  }

  /**
   * Per-session overrides. Each one must also be enabled on the agent
   * (ElevenLabs → Agent → Security → Overrides), otherwise ElevenLabs rejects
   * the session, which is why each is opt-in via env:
   *  • ELEVENLABS_VOICE_ID            bind the Food Fusion custom voice
   *  • ELEVENLABS_FIRST_MESSAGE       the greeting spoken on connect
   *  • ELEVENLABS_BOOST_MENU_KEYWORDS "true" → dish words as ASR keywords,
   *                                   so "Peshawari" isn't heard as "Peshawar".
   */
  private overrides(voiceId?: string) {
    const o: {
      tts?: { voiceId: string };
      asr?: { keywords: string[] };
    } = {};
    if (voiceId) o.tts = { voiceId };
    // The connected agent owns its first message. Never inject a local or
    // server fallback greeting, which could mask a broken agent binding.
    return Object.keys(o).length ? o : undefined;
  }
}

/** Distinctive words from dish names (skips common English), capped. */
export function menuKeywords(names: string[], max = 60): string[] {
  const common = new Set([
    'with',
    'and',
    'the',
    'chicken',
    'beef',
    'served',
    'sauce',
    'new',
    'cream',
    'fried',
    'rice',
    'cake',
    'slice',
    'juice',
  ]);
  const counts = new Map<string, number>();
  for (const name of names) {
    for (const raw of name.toLowerCase().split(/[^a-z]+/)) {
      if (raw.length < 4 || common.has(raw)) continue;
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}
