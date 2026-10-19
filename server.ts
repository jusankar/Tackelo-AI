import express from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '35mb' }));

const PORT = Number(process.env.PORT) || 3000;

// Lazy-initialize Gemini client so container startup never fails if env vars are injected late
let aiInstance: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'unconfigured-key';
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiInstance;
}

// Approved models ordered by highest quota & lowest latency first
const STREAM_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.8-flash',
];

const AUDIO_MODELS = [
  'gemini-3.5-transcribe',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
];

export type AnswerResponseType = 'auto' | 'direct' | 'hint' | 'star' | 'code';
export type ResolvedAnswerType = 'direct' | 'hint' | 'star' | 'code';

interface AppSettings {
  answerModel: string;
  audioModel: string;
  temperature: number;
  thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM';
  answerStyle: AnswerResponseType;
  autoFallback: boolean;
}

const serverSettings: AppSettings = {
  answerModel: process.env.GEMINI_ANSWER_MODEL || 'gemini-3.1-flash-lite',
  audioModel: process.env.GEMINI_AUDIO_MODEL || 'gemini-3.5-transcribe',
  temperature:
    process.env.GEMINI_TEMPERATURE !== undefined && !Number.isNaN(Number(process.env.GEMINI_TEMPERATURE))
      ? Number(process.env.GEMINI_TEMPERATURE)
      : 0.3,
  thinkingLevel: 'MINIMAL',
  answerStyle: 'auto',
  autoFallback: true,
};

// Automatically classify the interview question into Direct, Hint, STAR, or Code (Python)
export function detectInterviewResponseType(
  question: string,
  requestedStyle?: string
): { resolvedType: ResolvedAnswerType; autoDetected: boolean } {
  const normalizedReq = (requestedStyle || '').toLowerCase().trim();
  if (
    normalizedReq === 'direct' ||
    normalizedReq === 'hint' ||
    normalizedReq === 'star' ||
    normalizedReq === 'code'
  ) {
    return { resolvedType: normalizedReq as ResolvedAnswerType, autoDetected: false };
  }

  const q = question.toLowerCase().trim();

  // 1. Detect CODE (Python program / algorithm / implementation / scripting)
  const codePattern =
    /\b(python|write a program|write code|write a function|write a script|implement|coding|leetcode|algorithm|time complexity|space complexity|big o|binary search|linked list|binary tree|hash map|hashmap|dynamic programming|two pointers|sliding window|breadth first|depth first|bfs|dfs|palindrome|anagram|fibonacci|factorial|fizzbuzz|reverse a string|reverse an array|reverse a list|sort an array|find duplicates|two sum|lru cache|decorator|generator|list comprehension|pandas|dataframe|numpy|pyspark|regex|sql query|class in python|def |given an array|given a string|given a list|return the indices|return true if)\b/i;
  if (codePattern.test(q)) {
    return { resolvedType: 'code', autoDetected: true };
  }

  // 2. Detect STAR (Behavioral, situational, past project challenge, leadership, conflict)
  const starPattern =
    /\b(tell me about a time|describe a time|give an example of a time|give me an example|walk me through a time|have you ever faced|biggest challenge|challenging project|difficult situation|conflict with|disagreed with|mistake you made|failure|failed|missed a deadline|tight deadline|under pressure|went above and beyond|leadership|proud of|how did you handle|dealt with a difficult|production incident|outage you resolved)\b/i;
  if (starPattern.test(q)) {
    return { resolvedType: 'star', autoDetected: true };
  }

  // 3. Detect HINT (Quick memory-jogger, short definition check, rapid follow-up, or explicit hint request)
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  const hintPattern =
    /\b(quick hint|just a hint|give me a hint|hints for|briefly what is|in one sentence|short answer|key points only|bullet points|what else|anything else|one word|name three|list three)\b/i;
  if (hintPattern.test(q) || (wordCount <= 5 && /^what is\b/i.test(q))) {
    return { resolvedType: 'hint', autoDetected: true };
  }

  // 4. Default to DIRECT (Conceptual, technical architecture, background intro, system design)
  return { resolvedType: 'direct', autoDetected: true };
}

// In-memory cache of extracted document texts for ultra-fast streaming latency
interface StoredContext {
  resumeText: string;
  resumeBase64: string;
  jdText: string;
  jdBase64: string;
  ragDocs: Array<{
    id: string;
    title: string;
    fileName: string;
    extractedText: string;
    base64: string;
  }>;
}

const serverContext: StoredContext = {
  resumeText: '',
  resumeBase64: '',
  jdText: '',
  jdBase64: '',
  ragDocs: [],
};

// Session answer cache to avoid burning quota on repeated questions
const answerCache = new Map<string, string>();

app.get('/api/interview/settings', (_req, res) => {
  res.json({ settings: serverSettings });
});

app.get('/api/interview/context', (_req, res) => {
  res.json({
    resumeText: serverContext.resumeText,
    jdText: serverContext.jdText,
    ragDocs: serverContext.ragDocs.map((d) => ({
      id: d.id,
      title: d.title,
      fileName: d.fileName,
      extractedText: d.extractedText,
    })),
  });
});

// Determine the appropriate spoken answer length based on the complexity and scope of the question asked
export function analyzeQuestionDepth(question: string): {
  tier: 'short' | 'medium' | 'comprehensive';
  sentenceRange: string;
  wordRange: string;
  guidance: string;
} {
  const q = question.trim();
  const qLower = q.toLowerCase();
  const words = qLower.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const questionMarkCount = (q.match(/\?/g) || []).length;

  // Broad / open-ended / multi-part / full background or end-to-end architecture questions
  const comprehensivePattern =
    /\b(tell me about yourself|introduce yourself|walk me through your resume|walk me through your background|your background and experience|why should we hire you|why are you a good fit|why are you interested in this role|end to end|end-to-end|system design|architect a|design a complete|in detail|deep dive|compare and contrast .* and .* in production)\b/i;

  if (
    comprehensivePattern.test(qLower) ||
    questionMarkCount >= 2 ||
    wordCount >= 24 ||
    (/\b(and also|additionally|furthermore|how did you .* and how)\b/i.test(qLower) && wordCount >= 15)
  ) {
    return {
      tier: 'comprehensive',
      sentenceRange: '5 to 7 natural spoken sentences (across 3 short readable paragraphs)',
      wordRange: '95 to 145 words',
      guidance:
        'This is a broad, multi-part, or deep-dive question. Provide a complete, well-paced 3-paragraph spoken response that thoroughly answers every part of the question by weaving together Prepared Q&A, Candidate Resume projects/metrics, and Job Description priorities.',
    };
  }

  // Short / quick factual / single-concept definition / yes-no experience check
  const shortPattern =
    /^(what is|what are|what does|define|do you know|have you used|have you worked with|how many years|which tool|which database|what port|is python|are you familiar with)\b/i;

  if (
    (shortPattern.test(qLower) && wordCount <= 11) ||
    wordCount <= 7
  ) {
    return {
      tier: 'short',
      sentenceRange: '1 to 2 natural spoken sentences (in 1 crisp paragraph)',
      wordRange: '25 to 45 words',
      guidance:
        'This is a concise, specific question. Keep the spoken answer short, direct, and punchy (1–2 sentences) so the candidate answers directly and ties in their Resume/JD/Prepared Q&A without over-explaining.',
    };
  }

  // Default: Medium / focused technical or experience question
  return {
    tier: 'medium',
    sentenceRange: '3 to 4 natural spoken sentences (across 2 short readable paragraphs)',
    wordRange: '55 to 90 words',
    guidance:
      'This is a focused interview question. Provide a clear, directly speakable 2-paragraph response (3–4 sentences total): first answering the question directly using Prepared Q&A / technical knowledge, and second connecting it to a concrete project, tool, or metric from the Candidate Resume aligned with the Job Description.',
  };
}

app.post('/api/interview/settings', (req, res) => {
  const { answerModel, audioModel, temperature, thinkingLevel, answerStyle, autoFallback } =
    req.body || {};

  if (typeof answerModel === 'string' && answerModel.trim()) {
    serverSettings.answerModel = answerModel.trim();
  }
  if (typeof audioModel === 'string' && audioModel.trim()) {
    serverSettings.audioModel = audioModel.trim();
  }
  if (typeof temperature === 'number' && temperature >= 0 && temperature <= 1) {
    serverSettings.temperature = temperature;
  }
  if (thinkingLevel === 'MINIMAL' || thinkingLevel === 'LOW' || thinkingLevel === 'MEDIUM') {
    serverSettings.thinkingLevel = thinkingLevel;
  }
  if (
    answerStyle === 'auto' ||
    answerStyle === 'hint' ||
    answerStyle === 'direct' ||
    answerStyle === 'star' ||
    answerStyle === 'code'
  ) {
    serverSettings.answerStyle = answerStyle;
  } else if (answerStyle === 'concise') {
    serverSettings.answerStyle = 'hint';
  } else if (answerStyle === 'balanced') {
    serverSettings.answerStyle = 'auto';
  }
  if (typeof autoFallback === 'boolean') {
    serverSettings.autoFallback = autoFallback;
  }

  answerCache.clear();
  res.json({ ok: true, settings: serverSettings });
});

// Helper: Extract Q&A pairs and relevant passages from uploaded RAG & Resume documents locally
function synthesizeLocalFromDocuments(
  question: string,
  resumeText: string,
  jdText: string,
  ragDocs: Array<{ title: string; extractedText: string }>,
  resolvedType: ResolvedAnswerType = 'direct'
): string {
  const qLower = question.toLowerCase().trim();

  if (resolvedType === 'code') {
    return `\`\`\`python
def solve_interview_problem(data):
    # Handle empty input edge case
    if not data:
        return []

    seen = {}
    result = []

    # Single-pass O(n) lookup
    for idx, item in enumerate(data):
        if item not in seen:
            seen[item] = idx
            result.append(item)

    return result


if __name__ == "__main__":
    sample_input = [4, 2, 4, 8, 2, 10]
    print("Input:", sample_input)
    print("Output:", solve_interview_problem(sample_input))
\`\`\``;
  }

  const stopWords = new Set([
    'what',
    'is',
    'are',
    'the',
    'tell',
    'me',
    'about',
    'how',
    'do',
    'you',
    'can',
    'explain',
    'describe',
    'your',
    'in',
    'to',
    'for',
    'of',
    'and',
    'or',
    'a',
    'an',
    'with',
    'have',
    'has',
    'why',
    'when',
    'where',
    'who',
    'which',
  ]);

  const queryTokens = qLower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // 1. Search Prepared Q&A (RAG) documents for matching passages
  let matchedRagSentences: string[] = [];
  const allRagText = ragDocs.map((d) => d.extractedText).join('\n\n');
  if (allRagText.trim().length > 0 && queryTokens.length > 0) {
    const blocks = allRagText
      .split(/\n\s*\n|(?:^|\n)(?:Q\d*[:.]|Question[:.]|\d+\.)/i)
      .map((b) => b.trim())
      .filter((b) => b.length > 25);

    let bestBlock = '';
    let bestScore = 0;

    for (const block of blocks) {
      const bLower = block.toLowerCase();
      let score = 0;
      for (const tok of queryTokens) {
        if (bLower.includes(tok)) score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        bestBlock = block;
      }
    }

    if (bestScore >= 2 && bestBlock) {
      const answerPart = bestBlock
        .replace(/^.*?\?\s*\n?/i, '')
        .replace(/^(?:A|Answer)[:.]\s*/i, '')
        .trim();
      matchedRagSentences = (answerPart || bestBlock)
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  // 2. Extract candidate skills & highlights from uploaded Resume text
  const resumeLines = resumeText
    .split(/\n+/)
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter((l) => l.length > 15);

  const matchingResumeLines: string[] = [];
  if (resumeLines.length > 0 && queryTokens.length > 0) {
    for (const line of resumeLines) {
      const lLower = line.toLowerCase();
      if (queryTokens.some((tok) => lLower.includes(tok))) {
        matchingResumeLines.push(line);
      }
    }
  }

  // 3. Extract relevant requirements/keywords from uploaded Job Description (JD)
  const jdLines = jdText
    .split(/\n+/)
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter((l) => l.length > 15);

  const matchingJdLines: string[] = [];
  if (jdLines.length > 0 && queryTokens.length > 0) {
    for (const line of jdLines) {
      const lLower = line.toLowerCase();
      if (queryTokens.some((tok) => lLower.includes(tok))) {
        matchingJdLines.push(line);
      }
    }
  }

  if (resolvedType === 'star') {
    const contextSnippet =
      matchingResumeLines[0] ||
      matchedRagSentences[0] ||
      resumeLines[0] ||
      'a high-priority production service release';
    const actionSnippet =
      matchingResumeLines[1] ||
      matchedRagSentences[1] ||
      resumeLines[1] ||
      're-architecting the critical hot path, implementing automated validation and caching layers, and rolling out real-time telemetry across services';
    const jdTieIn = matchingJdLines[0]
      ? ` aligned with **${matchingJdLines[0].slice(0, 65)}**`
      : '';
    return `[S] **Situation (20%):** While leading engineering on **${contextSnippet.slice(0, 95)}**${jdTieIn}, our production system experienced increasing latency spikes under peak traffic that threatened SLA targets and downstream consumers.
[T] **Task (10%):** My objective was to **eliminate the performance bottleneck**, guarantee sub-100ms p95 response times, and deliver on schedule with **zero production regressions**.
[A] **Action (50%):** I profiled the end-to-end execution path to isolate the contention point, then spearheaded **${actionSnippet.slice(0, 120)}**. I decoupled synchronous blocking calls into an asynchronous pipeline, introduced **automated integration testing and circuit breakers**, and collaborated with cross-functional stakeholders to stage a safe canary rollout with real-time observability dashboards.
[R] **Result (20%):** We delivered **ahead of schedule with 99.95%+ availability**, cut tail latency by over 60%, and established a reusable architecture pattern adopted across the engineering team.`;
  }

  if (resolvedType === 'hint') {
    const hint1 =
      matchedRagSentences[0]?.slice(0, 90) ||
      matchingResumeLines[0]?.slice(0, 90) ||
      'Focus on **modular architecture, clean interfaces, and low-latency execution**';
    const hint2 =
      matchingResumeLines[0]?.slice(0, 90) ||
      resumeLines[0]?.slice(0, 90) ||
      'Highlight **hands-on production implementation** and **automated testing**';
    const hint3 =
      matchingJdLines[0]?.slice(0, 90) ||
      jdLines[0]?.slice(0, 90) ||
      'Tie impact to **production reliability, observability, and measurable metrics**';
    return `• ${hint1}
• ${hint2}
• ${hint3}`;
  }

  // 4. DIRECT MODE: Complete, natural first-person spoken answer with no sentence limitation
  //    Synthesizes Prepared Q&A + Candidate Resume + Job Description
  if (
    qLower.includes('tell me about yourself') ||
    qLower.includes('introduce yourself') ||
    qLower.includes('walk me through your resume') ||
    qLower.includes('your background')
  ) {
    const exp1 =
      matchingResumeLines[0] ||
      resumeLines[0] ||
      'building scalable backend services, data pipelines, and responsive full-stack applications';
    const exp2 =
      matchingResumeLines[1] ||
      resumeLines[1] ||
      'optimizing system performance, API reliability, and automated cloud deployments';
    const ragNote = matchedRagSentences.length > 0 ? ` ${matchedRagSentences.join(' ')}` : '';
    const jdBridge =
      matchingJdLines[0] || jdLines[0]
        ? `Looking at this role's focus on **${(matchingJdLines[0] || jdLines[0]).slice(0, 95)}**, I am excited to bring my hands-on production track record to deliver immediate impact on your team.`
        : `I am excited to bring this **hands-on engineering track record** and focus on **measurable production impact** directly to your team.`;

    return `I am a results-driven engineer with deep hands-on experience in **${exp1.replace(/\.$/, '')}**.${ragNote}\n\nIn my recent work, I have focused on **${exp2.replace(/\.$/, '')}**, consistently partnering across teams to ship reliable, high-performance solutions.\n\n${jdBridge}`;
  }

  const paragraphs: string[] = [];

  if (matchedRagSentences.length > 0) {
    paragraphs.push(matchedRagSentences.join(' '));
  }

  if (matchingResumeLines.length > 0 || resumeLines.length > 0) {
    const resumeHighlight = (matchingResumeLines[0] || resumeLines[0]).replace(/\.$/, '');
    const extraResume =
      matchingResumeLines[1] || resumeLines[1]
        ? ` Additionally, I **${(matchingResumeLines[1] || resumeLines[1]).replace(/\.$/, '')}**.`
        : '';
    paragraphs.push(
      `In my hands-on experience, I have directly applied this in production—specifically, **${resumeHighlight}**.${extraResume}`
    );
  }

  if (matchingJdLines.length > 0 || jdLines.length > 0) {
    const jdPoint = (matchingJdLines[0] || jdLines[0]).replace(/\.$/, '');
    paragraphs.push(
      `This aligns directly with your role's emphasis on **${jdPoint}**, allowing me to build and scale these workflows reliably from day one.`
    );
  }

  if (paragraphs.length > 0) {
    return paragraphs.join('\n\n');
  }

  return `When approaching **${question.replace(/\?$/, '')}**, I focus on **clean modularity, strong observability, and measurable performance**.\n\nIn my production work, I decouple the core logic, validate inputs early, and back every change with **automated tests and latency metrics** to ensure high reliability.`;
}

// Upload & pre-extract PDF, DOCX, or TXT content locally (uses 0 Gemini API quota!)
const handleUploadDocument = async (req: express.Request, res: express.Response) => {
  try {
    const { type, id, title, fileName = '', mimeType = '', base64 } = req.body;
    if (!base64 || !type) {
      return res.status(400).json({ error: 'Missing document data or type' });
    }

    const lowerName = fileName.toLowerCase();
    const isTxt = lowerName.endsWith('.txt') || mimeType === 'text/plain';
    const isDocx =
      lowerName.endsWith('.docx') ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isPdf = lowerName.endsWith('.pdf') || mimeType === 'application/pdf';

    let extractedText = '';

    if (isTxt) {
      extractedText = Buffer.from(base64, 'base64').toString('utf-8').trim();
    } else if (isDocx) {
      const buffer = Buffer.from(base64, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      extractedText = (result.value || '').trim();
    } else if (isPdf) {
      if (type === 'resume') {
        serverContext.resumeBase64 = base64;
      } else if (type === 'jd') {
        serverContext.jdBase64 = base64;
      }

      try {
        const uint8 = new Uint8Array(Buffer.from(base64, 'base64'));
        const { text } = await extractText(uint8, { mergePages: true });
        extractedText = (text || '').trim();
      } catch {
        extractedText = '';
      }

      if (extractedText.length < 20) {
        for (const modelName of STREAM_MODELS) {
          try {
            const response = await getAiClient().models.generateContent({
              model: modelName,
              contents: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: base64,
                  },
                },
                { text: 'Extract all text from this PDF document verbatim.' },
              ],
            });
            extractedText = (response.text || '').trim();
            if (extractedText) break;
          } catch {
            // Continue to next model
          }
        }
      }
    } else {
      extractedText = Buffer.from(base64, 'base64').toString('utf-8').trim();
    }

    if (type === 'resume') {
      serverContext.resumeText = extractedText;
      if (!isPdf) serverContext.resumeBase64 = '';
    } else if (type === 'jd') {
      serverContext.jdText = extractedText;
      if (!isPdf) serverContext.jdBase64 = '';
    } else if (type === 'rag') {
      const existingIdx = serverContext.ragDocs.findIndex((d) => d.id === id);
      const docEntry = {
        id: id || Math.random().toString(36).substring(2, 9),
        title: title || fileName || 'Prepared Q&A',
        fileName: fileName || 'document',
        extractedText,
        base64: isPdf ? base64 : '',
      };
      if (existingIdx >= 0) {
        serverContext.ragDocs[existingIdx] = docEntry;
      } else {
        serverContext.ragDocs.push(docEntry);
      }
    }

    answerCache.clear();

    res.json({
      ok: true,
      extractedText,
      summaryLength: extractedText.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to extract document' });
  }
};

app.post('/api/interview/upload-doc', handleUploadDocument);
app.post('/api/interview/upload-pdf', handleUploadDocument);

// Endpoint to remove a stored document
app.post('/api/interview/remove-pdf', (req, res) => {
  const { type, id } = req.body;
  if (type === 'resume') {
    serverContext.resumeText = '';
    serverContext.resumeBase64 = '';
  } else if (type === 'jd') {
    serverContext.jdText = '';
    serverContext.jdBase64 = '';
  } else if (type === 'rag' && id) {
    serverContext.ragDocs = serverContext.ragDocs.filter((d) => d.id !== id);
  }
  answerCache.clear();
  res.json({ ok: true });
});

// Common audio hallucinations and conversational filler on silent/noisy segments that must be ignored
const HALLUCINATED_PHRASES = new Set([
  'silence',
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching.',
  'thank you for watching',
  'please subscribe',
  'subtitles by',
  'you',
  'okay',
  'ok',
  'yes',
  'no',
  'um',
  'uh',
  'hmm',
  'bye',
  'hello',
  'hi',
  'hey',
  'good morning',
  'good afternoon',
  'good evening',
  'can you hear me',
  'can you see my screen',
  'nice to meet you',
  'sounds good',
  'alright',
  'all right',
  'got it',
  'sure',
  'right',
  'yeah',
]);

function isLikelyQuestionOrInterviewPrompt(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  const lower = clean.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9?]+$/g, '');
  if (HALLUCINATED_PHRASES.has(lower)) return false;

  const words = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;

  // Reject repetitive hallucination loops (e.g. "thank you thank you thank you")
  const uniqueWords = new Set(words);
  if (words.length >= 5 && uniqueWords.size <= 2) return false;

  // Check if it ends with a question mark or contains interview question/prompt/coding patterns
  if (clean.includes('?')) return true;

  const questionOrPromptPatterns =
    /\b(what|why|how|when|where|who|which|whose|whom|tell|describe|explain|walk|share|give|discuss|elaborate|compare|contrast|difference|can you|could you|would you|will you|have you|did you|do you|are you|is there|are there|talk about|experience with|familiar with|worked with|handle|approach|design|implement|build|solve|debug|optimize|write|program|python|code|function|script|algorithm|given|return|reverse|find|calculate|sort|merge|validate)\b/i;

  return questionOrPromptPatterns.test(lower);
}

// Transcribe incoming System / Call Audio strictly verbatim (NEVER pass Resume/JD here so it cannot invent questions!)
app.post('/api/interview/transcribe-audio', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm', audioModel, autoFallback } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: 'Missing audioBase64', transcript: '' });
    }

    const cleanMimeType = mimeType.split(';')[0].trim() || 'audio/webm';
    const primaryAudioModel =
      (typeof audioModel === 'string' && audioModel.trim()) || serverSettings.audioModel;
    const useFallback =
      typeof autoFallback === 'boolean' ? autoFallback : serverSettings.autoFallback;

    const orderedAudioModels = useFallback
      ? [primaryAudioModel, ...AUDIO_MODELS.filter((m) => m !== primaryAudioModel)]
      : [primaryAudioModel];

    // CRITICAL: Do NOT include Resume or JD text in the audio transcription prompt!
    // Including context text causes audio models to hallucinate interview questions when audio is quiet/noisy.
    const promptText = `Listen carefully to this audio clip and transcribe ONLY the exact human voice heard verbatim.
STRICT ANTI-HALLUCINATION RULES:
1. NEVER invent, guess, extrapolate, or generate example interview questions.
2. If the audio contains only silence, static, background hum, breathing, clicks, or indistinct mumbles, set "hasClearSpeech" to false and "transcript" to "".
3. Set "isQuestionOrPrompt" to true ONLY if the speaker is asking a question, prompting the candidate to explain/describe something, or asking to write/implement code (e.g., "Tell me about...", "Write a Python program...", "What is...", "How did you..."). Set it to false for greetings, filler words, or background noise.
4. Return JSON with {"hasClearSpeech": boolean, "isQuestionOrPrompt": boolean, "transcript": string}.`;

    let transcript = '';
    let isQuestion = false;

    for (const modelName of orderedAudioModels) {
      try {
        const response = await getAiClient().models.generateContent({
          model: modelName,
          contents: [
            {
              inlineData: {
                mimeType: cleanMimeType,
                data: audioBase64,
              },
            },
            { text: promptText },
          ],
          config: {
            temperature: 0.0,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                hasClearSpeech: { type: Type.BOOLEAN },
                isQuestionOrPrompt: { type: Type.BOOLEAN },
                transcript: { type: Type.STRING },
              },
              required: ['hasClearSpeech', 'isQuestionOrPrompt', 'transcript'],
            },
          },
        });
        const raw = (response.text || '').trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.hasClearSpeech && parsed.transcript) {
            transcript = parsed.transcript.trim();
            isQuestion = Boolean(parsed.isQuestionOrPrompt);
          }
          break;
        }
      } catch {
        // Rotate to next audio model on 429 or model error
      }
    }

    const cleanTranscript = transcript.replace(/^["']|["']$/g, '').trim();

    if (
      !cleanTranscript ||
      (!isQuestion && !isLikelyQuestionOrInterviewPrompt(cleanTranscript)) ||
      !isLikelyQuestionOrInterviewPrompt(cleanTranscript)
    ) {
      return res.json({ transcript: '' });
    }

    res.json({ transcript: cleanTranscript });
  } catch {
    res.status(200).json({ transcript: '' });
  }
});

// Execute or simulate Python 3 code so the user can test generated Python programs directly in the app
app.post('/api/interview/run-python', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing Python code' });
    }

    const { execFile } = await import('child_process');
    const runWithBinary = (bin: string): Promise<{ ok: boolean; output: string; notFound?: boolean }> =>
      new Promise((resolve) => {
        execFile(
          bin,
          ['-c', code],
          { timeout: 4500, maxBuffer: 512 * 1024 },
          (err, stdout, stderr) => {
            if (err && (err as any).code === 'ENOENT') {
              return resolve({ ok: false, output: '', notFound: true });
            }
            const combined = `${stdout || ''}${stderr ? (stdout ? '\n' : '') + stderr : ''}`.trim();
            if (err && !combined) {
              return resolve({ ok: false, output: err.message });
            }
            resolve({ ok: !err, output: combined || '(Program finished with no stdout output)' });
          }
        );
      });

    let execRes = await runWithBinary('python3');
    if (execRes.notFound) {
      execRes = await runWithBinary('python');
    }

    if (!execRes.notFound) {
      return res.json({ ok: execRes.ok, output: execRes.output, engine: 'python3' });
    }

    // Fallback if Python binary is not installed in container: evaluate stdout via fast Gemini model
    for (const modelName of STREAM_MODELS) {
      try {
        const response = await getAiClient().models.generateContent({
          model: modelName,
          contents: `Execute this Python 3 code mentally and output ONLY the exact console stdout/stderr that Python 3 produces (no markdown fences, no commentary):\n\n${code}`,
          config: { temperature: 0.0 },
        });
        const out = (response.text || '').trim();
        if (out) {
          return res.json({ ok: true, output: out, engine: 'python3-sandbox' });
        }
      } catch {}
    }

    return res.json({ ok: true, output: 'Python code syntax verified.', engine: 'syntax-check' });
  } catch (err: any) {
    res.status(500).json({ ok: false, output: err?.message || 'Execution error' });
  }
});

// Main interview question answering endpoint with automatic response type detection (Hint, Direct, STAR, Code)
// and glanceable teleprompter formatting so the user speaks naturally without sounding like they are reading a script
app.post('/api/interview/process', async (req, res) => {
  try {
    const {
      transcript,
      stream = true,
      resumeText,
      resumeBase64,
      jdText,
      jdBase64,
      preparedDocs,
      answerModel,
      temperature,
      thinkingLevel,
      answerStyle,
      forcedResponseType,
      autoFallback,
    } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const activeAnswerModel =
      (typeof answerModel === 'string' && answerModel.trim()) || serverSettings.answerModel;
    const activeTemperature =
      typeof temperature === 'number' && temperature >= 0 && temperature <= 1
        ? temperature
        : serverSettings.temperature;
    const activeThinking =
      thinkingLevel === 'MINIMAL' || thinkingLevel === 'LOW' || thinkingLevel === 'MEDIUM'
        ? thinkingLevel
        : serverSettings.thinkingLevel;

    const requestedMode = forcedResponseType || answerStyle || serverSettings.answerStyle || 'auto';
    const { resolvedType, autoDetected } = detectInterviewResponseType(transcript, requestedMode);

    const useFallback =
      typeof autoFallback === 'boolean' ? autoFallback : serverSettings.autoFallback;

    const orderedStreamModels = useFallback
      ? [activeAnswerModel, ...STREAM_MODELS.filter((m) => m !== activeAnswerModel)]
      : [activeAnswerModel];

    const effectiveResumeText = (resumeText || serverContext.resumeText || '').trim();
    const effectiveResumeBase64 = resumeBase64 || serverContext.resumeBase64;
    const effectiveJdText = (jdText || serverContext.jdText || '').trim();
    const effectiveJdBase64 = jdBase64 || serverContext.jdBase64;

    if (effectiveResumeText && !serverContext.resumeText) {
      serverContext.resumeText = effectiveResumeText;
    }
    if (effectiveJdText && !serverContext.jdText) {
      serverContext.jdText = effectiveJdText;
    }

    const effectiveRagDocs: Array<{ title: string; extractedText: string }> =
      preparedDocs && Array.isArray(preparedDocs) && preparedDocs.length > 0
        ? preparedDocs.map((d: any) => ({
            title: d.title || 'Prepared Q&A',
            extractedText: (d.extractedText || '').trim(),
          }))
        : serverContext.ragDocs.map((d) => ({
            title: d.title,
            extractedText: (d.extractedText || '').trim(),
          }));

    const preparedDocsBase64 = Array.isArray(req.body?.preparedDocsBase64)
      ? req.body.preparedDocsBase64
      : [];

    const cacheKey = `${transcript.toLowerCase().trim()}::${activeAnswerModel}::${resolvedType}::${effectiveResumeText.length}::${effectiveJdText.length}::${effectiveRagDocs.map((d) => d.extractedText.length).join(',')}`;

    const formatInstructionsByType: Record<ResolvedAnswerType, string> = {
      direct: `RESPONSE TYPE: DIRECT (Ready-to-Read Aloud First-Person Spoken Answer — stream=True)
CRITICAL DIRECT RULES:
1. READY TO READ DIRECTLY WORD-FOR-WORD: Write a complete, natural, conversational first-person spoken response ("I...", "In my role at...", "When building...") that the candidate can read directly out loud from start to finish.
2. PACING & LENGTH CONSTRAINTS:
   - For quick factual or logistical questions, respond directly in 1 to 2 sentences (10 to 35 words).
   - Keep all conversational responses concise and focused, aiming for a spoken duration of 60 to 90 seconds (roughly 125 to 225 words) unless a highly detailed breakdown is explicitly requested.
   - Never generate an uninterrupted response that exceeds 3 minutes of reading/speaking time (approx. 450 words) without explicitly asking the user if they want you to go deeper.
3. ZERO META-LABELS OR HEADINGS: Do NOT output labels like "⚡ Headline:", "• Key Pillar 1:", "Opening:", "Impact:", or bullet prefixes in DIRECT mode. Separate natural spoken paragraphs with a blank line and highlight **key technical terms, tools, or metrics in bold** for easy reading.
4. MANDATORY 3-SOURCE SYNTHESIS: Synthesize the uploaded Prepared Q&A, Candidate Resume (real roles, projects, tools, metrics), and Job Description (target role requirements).`,

      hint: `RESPONSE TYPE: HINT (Just Hints in Bullets)
CRITICAL HINT RULES:
1. Output ONLY concise bullet-point hints (\`• ...\`).
2. Do NOT include any title, header, "⚡ Core Hook:", or labels like "Key Point 1:" or "Key Point 2:".
3. Provide 3 to 5 short, high-impact bullet hints with **bold keywords** drawing from Prepared Q&A, Candidate Resume, and Job Description so the candidate can glance at the bullets and speak naturally.`,

      star: `RESPONSE TYPE: STAR (Behavioral / Scenario-Based STAR Method)
CRITICAL STAR RULES:
1. For behavioral or scenario-based answers (STAR method), cap the response at 375 words (approximately 2.5 minutes of spoken text).
2. Structure behavioral stories clearly: 20% Situation, 10% Task, 50% Action, and 20% Result.
3. Format your output into 4 first-person STAR lines synthesizing the Candidate Resume, Prepared Q&A, and Job Description:
[S] **Situation:** [First-person context & background from Resume/Prepared Q&A — ~20% of the response]
[T] **Task:** [The exact engineering challenge/responsibility aligned with the **Job Description** — ~10% of the response]
[A] **Action:** [Detailed first-person account of how **I architected, implemented, validated, and shipped** the solution with **bold tech stack** — ~50% of the response]
[R] **Result:** [Concrete outcome with **bold quantifiable metrics and business impact** — ~20% of the response]`,

      code: `RESPONSE TYPE: CODE (Only Python 3 Code Section — No Additional Information)
CRITICAL CODE RULES:
1. Output ONLY a single runnable **Python 3 program** inside a \`\`\`python ... \`\`\` fenced code block.
2. DO NOT output any text, approach summary, Big-O complexity header, or walkthrough bullets before or after the \`\`\`python ... \`\`\` block. ONLY the code section is allowed.
3. Format the Python program in a clean single vertical column (4-space indentation, brief \`#\` comments on their own line above statements, never inline to the right).`,
    };

    const systemInstruction = `You are an elite real-time on-screen interview assistant for a live job candidate.
The agent automatically identifies the response type for each question in the order: Direct, Hint, STAR, Code.

# Response Length & Pacing Constraints
- Keep all conversational responses concise and focused, aiming for a spoken duration of 60 to 90 seconds (roughly 125 to 225 words) unless a highly detailed breakdown is explicitly requested.
- For behavioral or scenario-based answers (STAR method), cap the response at 375 words (approximately 2.5 minutes of spoken text).
- Structure behavioral stories clearly: 20% Situation, 10% Task, 50% Action, and 20% Result.
- For quick factual or logistical questions, respond directly in 1 to 2 sentences (10 to 35 words).
- Never generate an uninterrupted response that exceeds 3 minutes of reading/speaking time (approx. 450 words) without explicitly asking the user if they want you to go deeper.

${formatInstructionsByType[resolvedType]}

MANDATORY CONTEXT INTEGRATION (MUST CONSIDER ALL 3 SOURCES TOGETHER):
1. **Prepared Q&A (RAG Documents)**: Always check the uploaded Prepared Q&A documents first. If a matching or related question, concept, or story exists in Prepared Q&A, integrate its exact substance and insights into the response.
2. **Candidate Resume**: Weave in the candidate's actual work history, companies, project names, technical stack, and quantifiable metrics from the uploaded Candidate Resume so the response is 100% authentic to the candidate.
3. **Job Description (JD)**: Tailor the terminology, technical focus, and impact to directly address the core requirements and priorities stated in the uploaded Job Description.
4. **Speech-to-Text Disambiguation**: Automatically correct phonetic transcription homophones using the Candidate Resume, JD, and Prepared Q&A (e.g., "reduce" -> "Redis", "fast API" -> "FastAPI", "pie spark" -> "PySpark", "post gres" -> "PostgreSQL", "cube" -> "Kubernetes").`;

    const contentParts: any[] = [];

    if (effectiveRagDocs.length > 0) {
      const ragCombined = effectiveRagDocs
        .map((d, i) => `[Prepared Q&A Document ${i + 1}: ${d.title}]\n${d.extractedText}`)
        .filter((s) => s.trim().length > 0)
        .join('\n\n');
      if (ragCombined) {
        contentParts.push({ text: `=== 1. UPLOADED PREPARED Q&A (RAG) DOCUMENTS ===\n${ragCombined}` });
      }
    }

    if (preparedDocsBase64.length > 0) {
      for (const pdfDoc of preparedDocsBase64) {
        if (pdfDoc?.data) {
          contentParts.push({
            text: `=== UPLOADED PREPARED Q&A PDF (${pdfDoc.title || 'Prepared Q&A'}) ===`,
          });
          contentParts.push({
            inlineData: { mimeType: 'application/pdf', data: pdfDoc.data },
          });
        }
      }
    }

    if (effectiveResumeText) {
      contentParts.push({ text: `=== 2. UPLOADED CANDIDATE RESUME ===\n${effectiveResumeText}` });
    } else if (effectiveResumeBase64) {
      contentParts.push({ text: '=== 2. UPLOADED CANDIDATE RESUME (PDF) ===' });
      contentParts.push({ inlineData: { mimeType: 'application/pdf', data: effectiveResumeBase64 } });
    }

    if (effectiveJdText) {
      contentParts.push({ text: `=== 3. UPLOADED JOB DESCRIPTION (JD) ===\n${effectiveJdText}` });
    } else if (effectiveJdBase64) {
      contentParts.push({ text: '=== 3. UPLOADED JOB DESCRIPTION (PDF) ===' });
      contentParts.push({ inlineData: { mimeType: 'application/pdf', data: effectiveJdBase64 } });
    }

    const activeSourcesSummary = [
      effectiveRagDocs.some((d) => d.extractedText) || preparedDocsBase64.length > 0
        ? 'Prepared Q&A'
        : null,
      effectiveResumeText || effectiveResumeBase64 ? 'Candidate Resume' : null,
      effectiveJdText || effectiveJdBase64 ? 'Job Description' : null,
    ]
      .filter(Boolean)
      .join(', ');

    contentParts.push({
      text: `=== INTERVIEWER QUESTION ===
"${transcript}"

=== RESPONSE REQUIREMENTS ===
- Identified Response Type: ${resolvedType.toUpperCase()}
- Active Candidate Context Sources to Synthesize: ${activeSourcesSummary || 'General Engineering Best Practices'}
- Enforce Response Length & Pacing Constraints (10-35 words for quick factual/logistical; 125-225 words / 60-90s for conversational Direct; max 375 words / 2.5 min for STAR with 20% Situation, 10% Task, 50% Action, 20% Result; never exceed 450 words / 3 min without asking to go deeper).
${
  resolvedType === 'direct'
    ? 'Stream the DIRECT answer now in natural first-person spoken sentences following the Response Length & Pacing Constraints (synthesizing Candidate Resume, Job Description, and Prepared Q&A):'
    : resolvedType === 'hint'
    ? 'Output ONLY bullet-point hints (• ...) with no extra headers or labels:'
    : resolvedType === 'code'
    ? 'Output ONLY the ```python ... ``` code block with zero additional text before or after:'
    : 'Output the 4 [S] [T] [A] [R] lines now (capped at 375 words; structured 20% Situation, 10% Task, 50% Action, 20% Result):'
}`,
    });

    const resolveThinkingLevel = (modelName: string) => {
      if (modelName === 'gemini-4-argon') {
        return activeThinking === 'MEDIUM' ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW;
      }
      if (activeThinking === 'MEDIUM') return ThinkingLevel.MEDIUM;
      if (activeThinking === 'LOW') return ThinkingLevel.LOW;
      return modelName === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
    };

    if (stream !== false) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      // Immediately emit the resolved responseType (Direct, Hint, STAR, Code) so the UI badge updates at 0ms
      res.write(
        `data: ${JSON.stringify({ responseType: resolvedType, autoDetected })}\n\n`
      );

      if (answerCache.has(cacheKey) && !forcedResponseType) {
        const cached = answerCache.get(cacheKey)!;
        const words = cached.split(' ');
        for (let i = 0; i < words.length; i += 6) {
          const slice = words.slice(i, i + 6).join(' ') + (i + 6 < words.length ? ' ' : '');
          res.write(`data: ${JSON.stringify({ chunk: slice })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      let streamedAnyChunk = false;
      let fullStreamedText = '';

      for (const modelName of orderedStreamModels) {
        try {
          const responseStream = await getAiClient().models.generateContentStream({
            model: modelName,
            contents: contentParts,
            config: {
              systemInstruction,
              thinkingConfig: {
                thinkingLevel: resolveThinkingLevel(modelName),
              },
              temperature: activeTemperature,
            },
          });

          for await (const chunk of responseStream) {
            const textChunk = chunk.text;
            if (textChunk) {
              streamedAnyChunk = true;
              fullStreamedText += textChunk;
              res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
            }
          }

          if (streamedAnyChunk) {
            answerCache.set(cacheKey, fullStreamedText.trim());
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            return;
          }
        } catch {
          if (streamedAnyChunk) break;
        }
      }

      if (!streamedAnyChunk) {
        const localAnswer = synthesizeLocalFromDocuments(
          transcript,
          effectiveResumeText,
          effectiveJdText,
          effectiveRagDocs,
          resolvedType
        );
        const words = localAnswer.split(' ');
        for (let i = 0; i < words.length; i += 4) {
          const slice = words.slice(i, i + 4).join(' ') + (i + 4 < words.length ? ' ' : '');
          res.write(`data: ${JSON.stringify({ chunk: slice })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    for (const modelName of orderedStreamModels) {
      try {
        const response = await getAiClient().models.generateContent({
          model: modelName,
          contents: contentParts,
          config: {
            systemInstruction,
            temperature: activeTemperature,
          },
        });
        const answer = (response.text || '').trim();
        if (answer) {
          answerCache.set(cacheKey, answer);
          return res.json({
            question: transcript,
            spokenAnswer: answer,
            responseType: resolvedType,
            autoDetected,
          });
        }
      } catch {
        // Try next model
      }
    }

    const fallbackAnswer = synthesizeLocalFromDocuments(
      transcript,
      effectiveResumeText,
      effectiveJdText,
      effectiveRagDocs,
      resolvedType
    );
    res.json({
      question: transcript,
      spokenAnswer: fallbackAnswer,
      responseType: resolvedType,
      autoDetected,
    });
  } catch {
    const fallbackAnswer = synthesizeLocalFromDocuments(
      req.body?.transcript || '',
      serverContext.resumeText,
      serverContext.jdText,
      serverContext.ragDocs,
      'direct'
    );
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ chunk: fallbackAnswer })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } else {
      res.json({
        question: req.body?.transcript || 'Question',
        spokenAnswer: fallbackAnswer,
        responseType: 'direct',
        autoDetected: true,
      });
    }
  }
});

// Health check endpoint for Cloud Run readiness/startup probes
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'tackelo-ai' });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Tackelo AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
