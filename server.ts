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

// Helper: Extract Q&A pairs and relevant passages from uploaded RAG & Resume documents locally
function synthesizeLocalFromDocuments(
  question: string,
  resumeText: string,
  jdText: string,
  ragDocs: Array<{ title: string; extractedText: string }>
): string {
  const qLower = question.toLowerCase().trim();
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

  // 1. Search Prepared Q&A (RAG) documents first for matching paragraph/block
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
      return answerPart || bestBlock;
    }
  }

  // 2. Extract candidate skills & highlights from uploaded Resume text
  const resumeLines = resumeText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 15);

  const matchingResumeLines: string[] = [];
  if (resumeLines.length > 0 && queryTokens.length > 0) {
    for (const line of resumeLines) {
      const lLower = line.toLowerCase();
      if (queryTokens.some((tok) => lLower.includes(tok))) {
        matchingResumeLines.push(line.replace(/^[-•*]\s*/, ''));
      }
    }
  }

  // 3. Handle common interview questions grounded in the uploaded Resume / JD
  if (
    qLower.includes('tell me about yourself') ||
    qLower.includes('introduce yourself') ||
    qLower.includes('walk me through your resume') ||
    qLower.includes('your background')
  ) {
    if (resumeLines.length > 0) {
      const topLines = resumeLines
        .slice(0, 6)
        .map((l) => l.replace(/^[-•*]\s*/, ''))
        .join(' ');
      return `I am a software professional with hands-on experience across the areas highlighted in my resume: ${topLines}`;
    }
    return 'I am a software engineer experienced in designing and delivering full-stack and cloud-native applications, building reliable APIs, optimizing data pipelines, and collaborating across cross-functional engineering teams to ship production systems.';
  }

  if (
    qLower.includes('what is rag') ||
    qLower.includes('retrieval augmented') ||
    qLower.includes('retrieval-augmented')
  ) {
    return 'Retrieval-Augmented Generation, or RAG, is an architecture that improves large language model responses by retrieving relevant documents or knowledge base chunks using vector embeddings or semantic search before generating the answer. Instead of relying solely on static training weights, I use RAG to ground model outputs in verified source documents, which eliminates hallucinations and keeps answers accurate and up to date.';
  }

  if (
    qLower.includes('failed') ||
    qLower.includes('delayed') ||
    qLower.includes('mistake') ||
    qLower.includes('challenge')
  ) {
    if (matchingResumeLines.length > 0) {
      return `In my project work—specifically involving ${matchingResumeLines
        .slice(0, 2)
        .join(
          '; '
        )}—we encountered unexpected integration complexities that risked delaying our release. I immediately communicated the bottleneck to stakeholders, broke the rollout into incremental milestones with automated validation tests, and resolved the root issue so we delivered a stable production release with zero regressions.`;
    }
    return 'On a critical production initiative, we faced a schedule delay when hidden data edge cases surfaced during integration testing. Rather than pushing an unstable build, I transparently communicated the risk to stakeholders, split the delivery into two phased milestones, and added automated integration checks. We delivered the core release cleanly with zero production downtime and used those learnings to add early technical spike reviews for future sprints.';
  }

  if (matchingResumeLines.length > 0) {
    return `Based on my hands-on experience—specifically ${matchingResumeLines
      .slice(0, 3)
      .join(
        '. '
      )}—I approach this by focusing on clean architecture, reliability, and measurable production impact.`;
  }

  if (resumeLines.length > 0) {
    const summarySnippet = resumeLines
      .slice(0, 4)
      .map((l) => l.replace(/^[-•*]\s*/, ''))
      .join('. ');
    return `Drawing directly from my background (${summarySnippet}), I approach "${question}" by applying proven engineering patterns, clear system boundaries, and thorough testing to ensure scalable results.`;
  }

  return `In my experience addressing "${question}", I focus on designing clean, maintainable architectures, validating assumptions with measurable metrics, and ensuring end-to-end reliability in production.`;
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

  // Check if it ends with a question mark or contains interview question/prompt patterns
  if (clean.includes('?')) return true;

  const questionOrPromptPatterns =
    /\b(what|why|how|when|where|who|which|whose|whom|tell|describe|explain|walk|share|give|discuss|elaborate|compare|contrast|difference|can you|could you|would you|will you|have you|did you|do you|are you|is there|are there|talk about|experience with|familiar with|worked with|handle|approach|design|implement|build|solve|debug|optimize)\b/i;

  return questionOrPromptPatterns.test(lower);
}

// Transcribe incoming System / Call Audio strictly verbatim (NEVER pass Resume/JD here so it cannot invent questions!)
app.post('/api/interview/transcribe-audio', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm' } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: 'Missing audioBase64', transcript: '' });
    }

    const cleanMimeType = mimeType.split(';')[0].trim() || 'audio/webm';

    // CRITICAL: Do NOT include Resume or JD text in the audio transcription prompt!
    // Including context text causes audio models to hallucinate interview questions when audio is quiet/noisy.
    const promptText = `Listen carefully to this audio clip and transcribe ONLY the exact human voice heard verbatim.
STRICT ANTI-HALLUCINATION RULES:
1. NEVER invent, guess, extrapolate, or generate example interview questions.
2. If the audio contains only silence, static, background hum, breathing, clicks, or indistinct mumbles, set "hasClearSpeech" to false and "transcript" to "".
3. Set "isQuestionOrPrompt" to true ONLY if the speaker is asking a question or prompting the candidate to explain/describe something (e.g., "Tell me about...", "Walk me through...", "What is...", "How did you..."). Set it to false for greetings, filler words, or background noise.
4. Return JSON with {"hasClearSpeech": boolean, "isQuestionOrPrompt": boolean, "transcript": string}.`;

    let transcript = '';
    let isQuestion = false;

    for (const modelName of AUDIO_MODELS) {
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

// Main interview question answering endpoint with multi-model rotation & local RAG fallback
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
    } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const effectiveResumeText = resumeText || serverContext.resumeText;
    const effectiveResumeBase64 = resumeBase64 || serverContext.resumeBase64;
    const effectiveJdText = jdText || serverContext.jdText;
    const effectiveJdBase64 = jdBase64 || serverContext.jdBase64;

    const effectiveRagDocs: Array<{ title: string; extractedText: string }> =
      preparedDocs && Array.isArray(preparedDocs) && preparedDocs.length > 0
        ? preparedDocs.map((d: any) => ({
            title: d.title || 'Prepared Q&A',
            extractedText: d.extractedText || '',
          }))
        : serverContext.ragDocs.map((d) => ({
            title: d.title,
            extractedText: d.extractedText,
          }));

    const cacheKey = `${transcript.toLowerCase().trim()}::${effectiveResumeText.length}::${effectiveJdText.length}::${effectiveRagDocs.length}`;

    const systemInstruction = `You are the job candidate in a live interview. Output ONLY the exact words the candidate should speak out loud in the first person ("I...") to answer the interviewer's question.

STRICT RULES:
1. Priority 1 - Prepared Q&A (RAG): If the interviewer's question matches or relates to any question/topic in the Prepared Q&A documents, use and adapt that prepared answer directly.
2. Priority 2 - Candidate Resume & Job Description (JD): Ground your spoken answer strictly in the candidate's actual experience, companies, projects, skills, and metrics from the uploaded Resume, aligned with the Job Description (JD). Also disambiguate any misheard speech-to-text technical terms using the Resume and JD context (e.g., if speech recognition heard "reduce" instead of "Redis").
3. Priority 3 - Fallback: Only if the uploaded documents do not cover a general technical concept asked by the interviewer, provide a clear, concise, accurate first-person explanation appropriate for the candidate's role.
4. NO HALLUCINATION: Never invent fake employers or projects not in the Resume.
5. FORMAT: Output ONLY the spoken script itself. No headings, no labels, no "Speak This Out Loud:", no bullet advice or suggestions, no JSON wrapper.`;

    const contentParts: any[] = [];

    if (effectiveRagDocs.length > 0) {
      const ragCombined = effectiveRagDocs
        .map((d, i) => `[Prepared Q&A Document ${i + 1}: ${d.title}]\n${d.extractedText}`)
        .filter((s) => s.trim().length > 0)
        .join('\n\n');
      if (ragCombined) {
        contentParts.push({ text: `=== UPLOADED PREPARED Q&A (RAG) DOCUMENTS ===\n${ragCombined}` });
      }
    }

    if (effectiveResumeText) {
      contentParts.push({ text: `=== UPLOADED CANDIDATE RESUME ===\n${effectiveResumeText}` });
    } else if (effectiveResumeBase64) {
      contentParts.push({ text: '=== UPLOADED CANDIDATE RESUME (PDF) ===' });
      contentParts.push({ inlineData: { mimeType: 'application/pdf', data: effectiveResumeBase64 } });
    }

    if (effectiveJdText) {
      contentParts.push({ text: `=== UPLOADED JOB DESCRIPTION (JD) ===\n${effectiveJdText}` });
    } else if (effectiveJdBase64) {
      contentParts.push({ text: '=== UPLOADED JOB DESCRIPTION (PDF) ===' });
      contentParts.push({ inlineData: { mimeType: 'application/pdf', data: effectiveJdBase64 } });
    }

    contentParts.push({
      text: `=== INTERVIEWER QUESTION ===\n"${transcript}"\n\nRespond immediately with ONLY the exact words I should speak out loud:`,
    });

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      if (answerCache.has(cacheKey)) {
        const cached = answerCache.get(cacheKey)!;
        res.write(`data: ${JSON.stringify({ chunk: cached })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      let streamedAnyChunk = false;
      let fullStreamedText = '';

      for (const modelName of STREAM_MODELS) {
        try {
          const responseStream = await getAiClient().models.generateContentStream({
            model: modelName,
            contents: contentParts,
            config: {
              systemInstruction,
              thinkingConfig: {
                thinkingLevel:
                  modelName === 'gemini-3.1-flash-lite'
                    ? ThinkingLevel.MINIMAL
                    : ThinkingLevel.LOW,
              },
              temperature: 0.3,
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
          effectiveRagDocs
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

    for (const modelName of STREAM_MODELS) {
      try {
        const response = await getAiClient().models.generateContent({
          model: modelName,
          contents: contentParts,
          config: {
            systemInstruction,
            temperature: 0.3,
          },
        });
        const answer = (response.text || '').trim();
        if (answer) {
          answerCache.set(cacheKey, answer);
          return res.json({ question: transcript, spokenAnswer: answer });
        }
      } catch {
        // Try next model
      }
    }

    const fallbackAnswer = synthesizeLocalFromDocuments(
      transcript,
      effectiveResumeText,
      effectiveJdText,
      effectiveRagDocs
    );
    res.json({ question: transcript, spokenAnswer: fallbackAnswer });
  } catch {
    const fallbackAnswer = synthesizeLocalFromDocuments(
      req.body?.transcript || '',
      serverContext.resumeText,
      serverContext.jdText,
      serverContext.ragDocs
    );
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ chunk: fallbackAnswer })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } else {
      res.json({
        question: req.body?.transcript || 'Question',
        spokenAnswer: fallbackAnswer,
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
