import { Injectable, Logger } from '@nestjs/common';

export type AssistantSource = 'llm' | 'local';

export interface AssistantResult {
  reply: string;
  source: AssistantSource;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

const MAX_HISTORY = 8;
const MAX_SPOKEN_CHARS = 280;
const SESSION_TTL_MS = 30 * 60 * 1000;

const VOICE_SYSTEM_PROMPT = `أنت مساعد صوتي عربي يتحدث بشكل طبيعي ومختصر.
الرد سيُقرأ بصوت، لذلك:
- جملة أو جملتين كحد أقصى.
- لا تستخدم قوائم طويلة ولا ماركداون ولا رموز.
- كن واضحاً ومهذباً.
- إذا لم تفهم الكلام، اطلب إعادة الجملة باختصار.`;

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly sessions = new Map<
    string,
    { turns: ChatTurn[]; updatedAt: number }
  >();

  async generateReply(
    userText: string,
    sessionId = 'default',
  ): Promise<AssistantResult> {
    this.pruneSessions();
    const cleaned = this.normalizeUserText(userText);
    if (!cleaned) {
      return { reply: '', source: 'local' };
    }

    this.push(sessionId, { role: 'user', text: cleaned });

    let reply = '';
    let source: AssistantSource = 'local';

    if (this.isLlmConfigured()) {
      try {
        reply = await this.callLlm(sessionId);
        source = 'llm';
      } catch (error) {
        this.logger.warn(
          `LLM call failed, falling back to local assistant: ${error.message}`,
        );
        reply = this.localReply(cleaned);
      }
    } else {
      reply = this.localReply(cleaned);
    }

    reply = this.makeVoiceFriendly(reply);
    if (reply) {
      this.push(sessionId, { role: 'assistant', text: reply });
    }
    return { reply, source };
  }

  private isLlmConfigured(): boolean {
    return Boolean(
      process.env.LLM_API_URL ||
        process.env.LLM_API_KEY ||
        process.env.OPENAI_API_KEY,
    );
  }

  private async callLlm(sessionId: string): Promise<string> {
    const apiUrl =
      process.env.LLM_API_URL ||
      'https://api.openai.com/v1/chat/completions';
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
    const model = process.env.LLM_MODEL || 'gpt-4o-mini';
    const session = this.sessions.get(sessionId);
    const messages = [
      { role: 'system', content: VOICE_SYSTEM_PROMPT },
      ...(session?.turns || []).map((turn) => ({
        role: turn.role === 'assistant' ? 'assistant' : 'user',
        content: turn.text,
      })),
    ];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 120,
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`LLM HTTP ${response.status} ${body.slice(0, 180)}`);
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text || typeof text !== 'string') {
        throw new Error('LLM returned an empty response');
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }

  private localReply(text: string): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    const lower = compact.toLowerCase();

    if (this.matches(compact, ['السلام', 'سلام عليكم'])) {
      return 'وعليكم السلام. إزاي أقدر أساعدك؟';
    }
    if (this.matches(compact, ['مرحبا', 'أهلا', 'اهلا', 'هالو', 'hello', 'hi'])) {
      return 'أهلاً بيك. تفضل، أنا سامعك.';
    }
    if (this.matches(compact, ['صباح'])) {
      return 'صباح الخير. أقدر أساعدك بإيه؟';
    }
    if (this.matches(compact, ['مساء'])) {
      return 'مساء الخير. تفضل.';
    }
    if (this.matches(compact, ['ازيك', 'إزيك', 'كيف حالك', 'كيفك', 'عامل ايه'])) {
      return 'الحمد لله، تمام. وأنت عامل إيه؟';
    }
    if (this.matches(compact, ['شكرا', 'ميرسي', 'تسلم'])) {
      return 'العفو. لو محتاج حاجة تانية أنا موجود.';
    }
    if (this.matches(compact, ['مع السلامة', 'باي', 'إلى اللقاء', 'وقف', 'كفاية'])) {
      return 'حاضر. لما تحتاجني اضغط الميكروفون تاني.';
    }
    if (this.matches(compact, ['مين انت', 'من أنت', 'اسمك', 'تعرفني على نفسك'])) {
      return 'أنا المساعد الصوتي للمنظومة. اسمعني واتكلم بشكل طبيعي.';
    }
    if (this.matches(compact, ['ساعد', 'تقدر', 'ماذا تفعل', 'بتعمل ايه', 'help'])) {
      return 'تقدر تكلمني بشكل طبيعي. هسمع الجملة وأرد عليك بصوت مختصر.';
    }
    if (this.matches(compact, ['الوقت', 'الساعة', 'كام الساعة'])) {
      const now = new Date();
      const time = now.toLocaleTimeString('ar-EG', {
        hour: 'numeric',
        minute: '2-digit',
      });
      return `الساعة دلوقتي ${time}.`;
    }
    if (this.matches(compact, ['التاريخ', 'النهارده', 'اليوم'])) {
      const today = new Date().toLocaleDateString('ar-EG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      return `النهارده ${today}.`;
    }

    // Open-ended fallback without an LLM: acknowledge briefly, do not read a paragraph.
    const snippet = this.shortQuote(compact);
    if (lower.length < 12) {
      return `تمام، سمعت «${snippet}». تحب أساعدك في إيه؟`;
    }
    return `فاهمك. قلت «${snippet}». لو حابب تفاصيل أكتر قولي بجملة أوضح.`;
  }

  private matches(text: string, needles: string[]): boolean {
    return needles.some((needle) => text.includes(needle));
  }

  private shortQuote(text: string): string {
    const clipped = text.length > 48 ? `${text.slice(0, 48).trim()}…` : text;
    return clipped;
  }

  private normalizeUserText(text: string): string {
    return (text || '')
      .replace(/[\u064B-\u0652]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  makeVoiceFriendly(text: string): string {
    if (!text) return '';
    let spoken = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_#>`]/g, '')
      .replace(/^\s*[-•]\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();

    const sentences = spoken.split(/(?:[.!?؟。]+)\s+/).filter(Boolean);
    if (sentences.length > 2) {
      spoken = `${sentences[0]}. ${sentences[1]}`.replace(/\.\s*\./g, '.');
    }
    if (spoken.length > MAX_SPOKEN_CHARS) {
      spoken = `${spoken.slice(0, MAX_SPOKEN_CHARS).trim()}…`;
    }
    return spoken;
  }

  private push(sessionId: string, turn: ChatTurn) {
    const existing = this.sessions.get(sessionId) || {
      turns: [],
      updatedAt: Date.now(),
    };
    existing.turns.push(turn);
    if (existing.turns.length > MAX_HISTORY) {
      existing.turns = existing.turns.slice(-MAX_HISTORY);
    }
    existing.updatedAt = Date.now();
    this.sessions.set(sessionId, existing);
  }

  private pruneSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}
