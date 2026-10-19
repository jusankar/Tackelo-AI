import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Square,
  Briefcase,
  BookOpen,
  Sparkles,
  Download,
  Trash2,
  ChevronRight,
  Copy,
  Check,
  Eye,
  EyeOff,
  Upload,
  User,
  RefreshCw,
  CheckCircle2,
  Volume2,
  MonitorSpeaker,
  Radio,
  Settings,
  Cpu,
  Sliders,
  ExternalLink,
  Move,
  Minimize2,
  Maximize2,
  Menu,
  X,
  Lock,
  KeyRound,
  Code2,
  Play,
  Zap,
  Lightbulb,
  Target,
  Award,
  Terminal,
} from 'lucide-react';

const APP_ACCESS_CODE = '2507';

export type AnswerResponseType = 'auto' | 'direct' | 'hint' | 'star' | 'code';
export type ResolvedAnswerType = 'direct' | 'hint' | 'star' | 'code';

interface QnAItem {
  id: string;
  timestamp: string;
  question: string;
  spokenAnswer: string;
  isStreaming?: boolean;
  responseType?: ResolvedAnswerType;
  autoDetected?: boolean;
  pythonOutput?: string;
  isRunningPython?: boolean;
}

const RESPONSE_TYPE_META: Record<
  ResolvedAnswerType,
  { label: string; shortLabel: string; badgeClass: string; desc: string }
> = {
  direct: {
    label: 'Direct (Read-Aloud Spoken Answer)',
    shortLabel: 'DIRECT',
    badgeClass: 'bg-indigo-950/80 text-indigo-300 border-indigo-500/40',
    desc: '60-90s (125-225 words) conversational or 1-2 sentences (10-35 words) factual, streamed with stream=True',
  },
  hint: {
    label: 'Hint (Bullet Hints Only)',
    shortLabel: 'HINT',
    badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-500/40',
    desc: 'Concise bullet-point hints so you can speak naturally in your own words',
  },
  star: {
    label: 'STAR (20% S · 10% T · 50% A · 20% R)',
    shortLabel: 'STAR',
    badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40',
    desc: 'Behavioral story capped at 375 words (~2.5 min): 20% Situation, 10% Task, 50% Action, 20% Result',
  },
  code: {
    label: 'Code (Python 3 Code Only)',
    shortLabel: 'CODE · PYTHON',
    badgeClass: 'bg-cyan-950/80 text-cyan-300 border-cyan-500/40',
    desc: 'Only the runnable Python 3 program in a single column (no extra commentary)',
  },
};

function detectInterviewResponseTypeClient(
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
  const codePattern =
    /\b(python|write a program|write code|write a function|write a script|implement|coding|leetcode|algorithm|time complexity|space complexity|big o|binary search|linked list|binary tree|hash map|hashmap|dynamic programming|two pointers|sliding window|breadth first|depth first|bfs|dfs|palindrome|anagram|fibonacci|factorial|fizzbuzz|reverse a string|reverse an array|reverse a list|sort an array|find duplicates|two sum|lru cache|decorator|generator|list comprehension|pandas|dataframe|numpy|pyspark|regex|sql query|class in python|def |given an array|given a string|given a list|return the indices|return true if)\b/i;
  if (codePattern.test(q)) {
    return { resolvedType: 'code', autoDetected: true };
  }

  const starPattern =
    /\b(tell me about a time|describe a time|give an example of a time|give me an example|walk me through a time|have you ever faced|biggest challenge|challenging project|difficult situation|conflict with|disagreed with|mistake you made|failure|failed|missed a deadline|tight deadline|under pressure|went above and beyond|leadership|proud of|how did you handle|dealt with a difficult|production incident|outage you resolved)\b/i;
  if (starPattern.test(q)) {
    return { resolvedType: 'star', autoDetected: true };
  }

  const wordCount = q.split(/\s+/).filter(Boolean).length;
  const hintPattern =
    /\b(quick hint|just a hint|give me a hint|hints for|briefly what is|in one sentence|short answer|key points only|bullet points|what else|anything else|one word|name three|list three)\b/i;
  if (hintPattern.test(q) || (wordCount <= 5 && /^what is\b/i.test(q))) {
    return { resolvedType: 'hint', autoDetected: true };
  }

  return { resolvedType: 'direct', autoDetected: true };
}

interface UploadedDocFile {
  name: string;
  size: number;
  mimeType: string;
  base64: string;
  extractedText?: string;
  isIndexing?: boolean;
}

interface PreparedDoc {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
  extractedText?: string;
  isIndexing?: boolean;
}

type AudioCaptureMode = 'system_audio' | 'loopback_device';

interface ModelOption {
  id: string;
  name: string;
  badge: string;
  recommended?: boolean;
  description: string;
  bestFor: string;
}

const SUGGESTED_ANSWER_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    badge: 'Recommended · Fastest & Highest Quota',
    recommended: true,
    description:
      'Ultra-low latency streaming with minimal thinking overhead and the highest request quota.',
    bestFor: 'Real-time live interviews, rapid technical Q&A, and uninterrupted token streaming.',
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash (Latest)',
    badge: 'Balanced Speed & Depth',
    description:
      'Balances fast streaming speed with deeper contextual synthesis across Resume, JD, and RAG docs.',
    bestFor: 'Behavioral STAR stories, role-aligned project walkthroughs, and general engineering interviews.',
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    badge: 'High-Accuracy Flash',
    description:
      'Strong technical reasoning and structured articulation while maintaining live conversational pacing.',
    bestFor: 'Architecture explanations, API design questions, and multi-document RAG synthesis.',
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Pro (Argon)',
    badge: 'Deepest Reasoning · Paid Tier',
    description:
      'Flagship reasoning model for complex system design, distributed systems trade-offs, and coding architecture.',
    bestFor: 'Staff/Principal engineering interviews and deep algorithmic or system design rounds.',
  },
];

const SUGGESTED_AUDIO_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.5-transcribe',
    name: 'Gemini 3.5 Transcribe',
    badge: 'Recommended · Dedicated Speech-to-Text',
    recommended: true,
    description:
      'Purpose-built speech transcription model tuned for accurate technical terms and question detection.',
    bestFor: 'Capturing incoming Zoom, Teams, and Google Meet interviewer audio streams.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite (Audio)',
    badge: 'High-Quota Audio Fallback',
    description:
      'Fast multimodal audio understanding with generous rate limits for long interview sessions.',
    bestFor: 'Continuous multi-round interviews where high request throughput is needed.',
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash Latest (Audio)',
    badge: 'Contextual Multimodal Audio',
    description:
      'High-accuracy multimodal speech recognition for accented speech or compressed call audio.',
    bestFor: 'Noisy or heavily compressed meeting audio streams.',
  },
];

const ACCEPTED_FILE_EXTENSIONS =
  '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

function isSupportedDocFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith('.pdf') ||
    lower.endsWith('.docx') ||
    lower.endsWith('.txt') ||
    file.type === 'application/pdf' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.type === 'text/plain'
  );
}

export default function App() {
  // Simple Passcode Authentication (Code: 2507) on entering the app
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('tackelo_auth_verified') === 'true';
    } catch {
      return false;
    }
  });
  const [authCodeInput, setAuthCodeInput] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [showAuthCode, setShowAuthCode] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<'setup' | 'copilot' | 'history' | 'settings'>('setup');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // Application & Model Configuration Settings
  const [answerModel, setAnswerModel] = useState<string>('gemini-3.1-flash-lite');
  const [audioModel, setAudioModel] = useState<string>('gemini-3.5-transcribe');
  const [temperature, setTemperature] = useState<number>(0.3);
  const [thinkingLevel, setThinkingLevel] = useState<'MINIMAL' | 'LOW' | 'MEDIUM'>('MINIMAL');
  const [answerStyle, setAnswerStyle] = useState<AnswerResponseType>('auto');
  const [autoFallback, setAutoFallback] = useState<boolean>(true);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string>('');

  // Document Upload States (PDF, DOCX, TXT) persisted so Resume, JD & Prepared Q&A are always available
  const [resumeFile, setResumeFile] = useState<UploadedDocFile | null>(() => {
    try {
      const saved = localStorage.getItem('tackelo_resume_doc');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [jdFile, setJdFile] = useState<UploadedDocFile | null>(() => {
    try {
      const saved = localStorage.getItem('tackelo_jd_doc');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [preparedDocs, setPreparedDocs] = useState<PreparedDoc[]>(() => {
    try {
      const saved = localStorage.getItem('tackelo_rag_docs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocFile, setNewDocFile] = useState<{
    name: string;
    mimeType: string;
    base64: string;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Incoming Audio Capture State
  const [captureMode, setCaptureMode] = useState<AudioCaptureMode>('system_audio');
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [audioStatusMsg, setAudioStatusMsg] = useState<string>('');
  const [isSpeakingDetected, setIsSpeakingDetected] = useState(false);
  const [liveTranscriptBuffer, setLiveTranscriptBuffer] = useState('');

  // Copilot Session State
  const [transcriptLog, setTranscriptLog] = useState<QnAItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [manualInput, setManualInput] = useState('');

  // Floating HUD Overlay & Separate Always-On-Top Window State
  const [isFloatingMode, setIsFloatingMode] = useState(false);
  const [opacity, setOpacity] = useState(0.78);
  const [hudFontSize, setHudFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [isHudMinimized, setIsHudMinimized] = useState(false);
  const [hudPosition, setHudPosition] = useState<{ x: number; y: number }>({ x: 24, y: 72 });
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [isVideoPipActive, setIsVideoPipActive] = useState(false);
  const [hudScrollLine, setHudScrollLine] = useState<number>(0);

  const pipWindowRef = useRef<Window | null>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudVideoRef = useRef<HTMLVideoElement | null>(null);
  const dragOffsetRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const normalizeAnswerStyle = (val?: string): AnswerResponseType => {
    if (val === 'hint' || val === 'direct' || val === 'star' || val === 'code' || val === 'auto') {
      return val;
    }
    if (val === 'concise') return 'hint';
    return 'auto';
  };

  // Refs to ensure audio callbacks always read latest uploaded documents & settings without stale closures
  const contextRef = useRef<{
    resumeFile: UploadedDocFile | null;
    jdFile: UploadedDocFile | null;
    preparedDocs: PreparedDoc[];
    answerModel: string;
    audioModel: string;
    temperature: number;
    thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM';
    answerStyle: AnswerResponseType;
    autoFallback: boolean;
  }>({
    resumeFile: null,
    jdFile: null,
    preparedDocs: [],
    answerModel: 'gemini-3.1-flash-lite',
    audioModel: 'gemini-3.5-transcribe',
    temperature: 0.3,
    thinkingLevel: 'MINIMAL',
    answerStyle: 'auto',
    autoFallback: true,
  });

  useEffect(() => {
    contextRef.current = {
      resumeFile,
      jdFile,
      preparedDocs,
      answerModel,
      audioModel,
      temperature,
      thinkingLevel,
      answerStyle,
      autoFallback,
    };
  }, [
    resumeFile,
    jdFile,
    preparedDocs,
    answerModel,
    audioModel,
    temperature,
    thinkingLevel,
    answerStyle,
    autoFallback,
  ]);

  // Persist extracted Resume, JD, and Prepared Q&A texts in localStorage so context is never lost
  useEffect(() => {
    try {
      if (resumeFile && !resumeFile.isIndexing) {
        localStorage.setItem(
          'tackelo_resume_doc',
          JSON.stringify({
            name: resumeFile.name,
            size: resumeFile.size,
            mimeType: resumeFile.mimeType,
            base64: '',
            extractedText: resumeFile.extractedText || '',
            isIndexing: false,
          })
        );
      } else if (!resumeFile) {
        localStorage.removeItem('tackelo_resume_doc');
      }
    } catch {}
  }, [resumeFile]);

  useEffect(() => {
    try {
      if (jdFile && !jdFile.isIndexing) {
        localStorage.setItem(
          'tackelo_jd_doc',
          JSON.stringify({
            name: jdFile.name,
            size: jdFile.size,
            mimeType: jdFile.mimeType,
            base64: '',
            extractedText: jdFile.extractedText || '',
            isIndexing: false,
          })
        );
      } else if (!jdFile) {
        localStorage.removeItem('tackelo_jd_doc');
      }
    } catch {}
  }, [jdFile]);

  useEffect(() => {
    try {
      const readyDocs = preparedDocs
        .filter((d) => !d.isIndexing)
        .map((d) => ({
          id: d.id,
          title: d.title,
          fileName: d.fileName,
          mimeType: d.mimeType,
          base64Data: '',
          extractedText: d.extractedText || '',
          isIndexing: false,
        }));
      localStorage.setItem('tackelo_rag_docs', JSON.stringify(readyDocs));
    } catch {}
  }, [preparedDocs]);

  // Sync any server-side stored context on initial load if local state is empty
  useEffect(() => {
    fetch('/api/interview/context')
      .then((r) => r.json())
      .then((ctx) => {
        if (ctx?.resumeText && !contextRef.current.resumeFile) {
          setResumeFile({
            name: 'Candidate Resume',
            size: ctx.resumeText.length,
            mimeType: 'text/plain',
            base64: '',
            extractedText: ctx.resumeText,
            isIndexing: false,
          });
        }
        if (ctx?.jdText && !contextRef.current.jdFile) {
          setJdFile({
            name: 'Job Description',
            size: ctx.jdText.length,
            mimeType: 'text/plain',
            base64: '',
            extractedText: ctx.jdText,
            isIndexing: false,
          });
        }
        if (
          Array.isArray(ctx?.ragDocs) &&
          ctx.ragDocs.length > 0 &&
          contextRef.current.preparedDocs.length === 0
        ) {
          setPreparedDocs(
            ctx.ragDocs.map((d: any) => ({
              id: d.id,
              title: d.title || 'Prepared Q&A',
              fileName: d.fileName || 'document',
              mimeType: 'text/plain',
              base64Data: '',
              extractedText: d.extractedText || '',
              isIndexing: false,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Load initial model & app settings from server/localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tackelo_ai_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.answerModel) setAnswerModel(parsed.answerModel);
        if (parsed.audioModel) setAudioModel(parsed.audioModel);
        if (typeof parsed.temperature === 'number') setTemperature(parsed.temperature);
        if (parsed.thinkingLevel) setThinkingLevel(parsed.thinkingLevel);
        if (parsed.answerStyle) setAnswerStyle(normalizeAnswerStyle(parsed.answerStyle));
        if (typeof parsed.autoFallback === 'boolean') setAutoFallback(parsed.autoFallback);
        return;
      }
    } catch {}

    fetch('/api/interview/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data?.settings) {
          if (data.settings.answerModel) setAnswerModel(data.settings.answerModel);
          if (data.settings.audioModel) setAudioModel(data.settings.audioModel);
          if (typeof data.settings.temperature === 'number')
            setTemperature(data.settings.temperature);
          if (data.settings.thinkingLevel) setThinkingLevel(data.settings.thinkingLevel);
          if (data.settings.answerStyle)
            setAnswerStyle(normalizeAnswerStyle(data.settings.answerStyle));
          if (typeof data.settings.autoFallback === 'boolean')
            setAutoFallback(data.settings.autoFallback);
        }
      })
      .catch(() => {});
  }, []);

  const saveAppSettings = async (nextSettings?: Partial<{
    answerModel: string;
    audioModel: string;
    temperature: number;
    thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM';
    answerStyle: AnswerResponseType;
    autoFallback: boolean;
  }>) => {
    const payload = {
      answerModel: nextSettings?.answerModel ?? answerModel,
      audioModel: nextSettings?.audioModel ?? audioModel,
      temperature: nextSettings?.temperature ?? temperature,
      thinkingLevel: nextSettings?.thinkingLevel ?? thinkingLevel,
      answerStyle: nextSettings?.answerStyle ?? answerStyle,
      autoFallback: nextSettings?.autoFallback ?? autoFallback,
    };

    try {
      localStorage.setItem('tackelo_ai_settings', JSON.stringify(payload));
    } catch {}

    try {
      await fetch('/api/interview/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setSettingsSavedMsg('Settings saved and applied to live session.');
      setTimeout(() => setSettingsSavedMsg(''), 2500);
    } catch {
      setSettingsSavedMsg('Settings saved locally.');
      setTimeout(() => setSettingsSavedMsg(''), 2500);
    }
  };

  // Web Audio, MediaRecorder & Hidden Media Sink Refs (Strictly Incoming Stream Only - No Laptop Mic)
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const hiddenVideoSinkRef = useRef<HTMLVideoElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const isListeningRef = useRef<boolean>(false);
  isListeningRef.current = isListening;

  const transcriptLogRef = useRef<QnAItem[]>([]);
  useEffect(() => {
    transcriptLogRef.current = transcriptLog;
  }, [transcriptLog]);

  // Deduplication ref so incoming audio capture never answers the same question twice
  const lastQuestionRef = useRef<{ text: string; time: number }>({ text: '', time: 0 });
  const hadSpeechInSegmentRef = useRef<boolean>(false);

  const isVirtualLoopbackLabel = (label: string): boolean =>
    /stereo mix|vb-audio|cable|loopback|what u hear|wave out|blackhole|soundflower|virtual audio/i.test(
      label
    );

  const isPhysicalMicLabel = (label: string): boolean => {
    if (!label) return false;
    if (isVirtualLoopbackLabel(label)) return false;
    return /microphone|internal mic|built-in|macbook|headset|airpods|earpods|webcam|usb mic|array/i.test(
      label
    );
  };

  // Enumerate virtual loopback audio devices (e.g. Stereo Mix, VB-Audio Virtual Cable, BlackHole)
  // Never auto-select the built-in laptop microphone
  const refreshAudioDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(
        (d) =>
          d.kind === 'audioinput' &&
          d.deviceId !== 'default' &&
          d.deviceId !== 'communications' &&
          !isPhysicalMicLabel(d.label)
      );
      setAudioDevices(inputs);

      const loopback = inputs.find((d) => isVirtualLoopbackLabel(d.label));
      if (loopback && !selectedDeviceId) {
        setSelectedDeviceId(loopback.deviceId);
      }
    } catch {
      // Ignore device enumeration errors prior to permission grant
    }
  };

  useEffect(() => {
    refreshAudioDevices();
  }, []);

  const isGenuineVoiceQuestion = (rawText: string): boolean => {
    const clean = rawText.trim();
    if (!clean) return false;

    const lower = clean.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9?]+$/g, '').trim();
    const ignoredPhrases = new Set([
      'thank you',
      'thanks for watching',
      'thank you for watching',
      'please subscribe',
      'okay thank you',
      'yes thank you',
      'hello everyone',
      'can you hear me',
      'can you see my screen',
      'nice to meet you',
      'good morning',
      'good afternoon',
      'good evening',
      'sounds good',
      'alright',
      'all right',
      'got it',
      'silence',
    ]);
    if (ignoredPhrases.has(lower)) return false;

    const words = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length < 3) return false;

    // Reject repetitive hallucination loops
    const uniqueWords = new Set(words);
    if (words.length >= 5 && uniqueWords.size <= 2) return false;

    if (clean.includes('?')) return true;

    const questionOrPromptPattern =
      /\b(what|why|how|when|where|who|which|whose|whom|tell|describe|explain|walk|share|give|discuss|elaborate|compare|contrast|difference|can you|could you|would you|will you|have you|did you|do you|are you|is there|are there|talk about|experience with|familiar with|worked with|handle|approach|design|implement|build|solve|debug|optimize|write|program|python|code|function|script|algorithm|given|return|reverse|find|calculate|sort|merge|validate)\b/i;

    return questionOrPromptPattern.test(lower);
  };

  const isEchoOfGeneratedAnswer = (rawText: string): boolean => {
    const recentItems = transcriptLogRef.current.slice(0, 5);
    if (recentItems.length === 0) return false;

    const spokenWords = rawText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    if (spokenWords.length === 0) return false;

    const normSpoken = spokenWords.join(' ');

    for (const item of recentItems) {
      if (!item.spokenAnswer) continue;
      const answerLower = item.spokenAnswer
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (normSpoken.length >= 15 && answerLower.includes(normSpoken)) {
        return true;
      }

      const answerWordSet = new Set(answerLower.split(' ').filter((w) => w.length > 3));
      const LongSpokenWords = spokenWords.filter((w) => w.length > 3);
      if (LongSpokenWords.length >= 4) {
        const matched = LongSpokenWords.filter((w) => answerWordSet.has(w)).length;
        if (matched / LongSpokenWords.length >= 0.65) {
          return true;
        }
      }
    }
    return false;
  };

  const handleAuthenticateSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (authCodeInput.trim() === APP_ACCESS_CODE) {
      setIsAuthenticated(true);
      setAuthError('');
      setAuthCodeInput('');
      setIsAuthModalOpen(false);
      try {
        sessionStorage.setItem('tackelo_auth_verified', 'true');
      } catch {}
    } else {
      setAuthError('Invalid access code. Please enter the authorized code to use Tackelo AI.');
    }
  };

  const lockApplication = () => {
    if (isListening) {
      stopIncomingAudioCapture();
    }
    setIsAuthenticated(false);
    setAuthCodeInput('');
    setAuthError('');
    setIsAuthModalOpen(true);
    try {
      sessionStorage.removeItem('tackelo_auth_verified');
    } catch {}
  };

  const runPythonProgram = async (itemId: string, code: string) => {
    setTranscriptLog((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, isRunningPython: true, pythonOutput: 'Running Python 3 program...' }
          : item
      )
    );
    try {
      const res = await fetch('/api/interview/run-python', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      setTranscriptLog((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                isRunningPython: false,
                pythonOutput: data.output || '(Completed with no stdout)',
              }
            : item
        )
      );
    } catch (err: any) {
      setTranscriptLog((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                isRunningPython: false,
                pythonOutput: `Execution error: ${err?.message || 'Failed to run Python'}`,
              }
            : item
        )
      );
    }
  };

  const processSpokenQuestion = async (
    text: string,
    isManual: boolean = false,
    forcedType?: ResolvedAnswerType,
    existingItemId?: string
  ) => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      return;
    }
    const cleanQuestion = text.trim();
    if (!cleanQuestion) return;

    // For automatic voice triggers, strictly allow only genuine spoken questions and reject any echo of answers being read aloud
    if (!isManual && !existingItemId) {
      if (!isGenuineVoiceQuestion(cleanQuestion)) return;
      if (isEchoOfGeneratedAnswer(cleanQuestion)) return;
    }

    // Deduplicate if the exact same or overlapping question was triggered within the last 8 seconds (unless manually switching type)
    if (!existingItemId && !forcedType) {
      const now = Date.now();
      const normNew = cleanQuestion.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normOld = lastQuestionRef.current.text.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        normNew &&
        normOld &&
        now - lastQuestionRef.current.time < 8000 &&
        (normNew === normOld || normNew.includes(normOld) || normOld.includes(normNew))
      ) {
        return;
      }
      lastQuestionRef.current = { text: cleanQuestion, time: now };
    }

    const {
      resumeFile: curResume,
      jdFile: curJd,
      preparedDocs: curRag,
      answerModel: curAnswerModel,
      temperature: curTemp,
      thinkingLevel: curThinking,
      answerStyle: curStyle,
      autoFallback: curFallback,
    } = contextRef.current;

    const effectiveMode = forcedType || curStyle || 'auto';
    const initialClassification = detectInterviewResponseTypeClient(cleanQuestion, effectiveMode);

    const itemId = existingItemId || Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    if (existingItemId) {
      setHudScrollLine(0);
      setTranscriptLog((prev) =>
        prev.map((item) =>
          item.id === existingItemId
            ? {
                ...item,
                spokenAnswer: '',
                isStreaming: true,
                responseType: initialClassification.resolvedType,
                autoDetected: initialClassification.autoDetected,
                pythonOutput: undefined,
              }
            : item
        )
      );
    } else {
      setHudScrollLine(0);
      const initialItem: QnAItem = {
        id: itemId,
        timestamp,
        question: cleanQuestion,
        spokenAnswer: '',
        isStreaming: true,
        responseType: initialClassification.resolvedType,
        autoDetected: initialClassification.autoDetected,
      };
      setTranscriptLog((prev) => [initialItem, ...prev]);
    }

    setIsProcessing(true);

    try {
      const response = await fetch('/api/interview/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: cleanQuestion,
          stream: true,
          answerModel: curAnswerModel,
          temperature: curTemp,
          thinkingLevel: curThinking,
          answerStyle: curStyle,
          forcedResponseType: forcedType,
          autoFallback: curFallback,
          resumeText: curResume?.extractedText,
          resumeBase64:
            curResume?.mimeType === 'application/pdf' || curResume?.name.toLowerCase().endsWith('.pdf')
              ? curResume?.base64
              : undefined,
          jdText: curJd?.extractedText,
          jdBase64:
            curJd?.mimeType === 'application/pdf' || curJd?.name.toLowerCase().endsWith('.pdf')
              ? curJd?.base64
              : undefined,
          preparedDocs: curRag.map((d) => ({
            id: d.id,
            title: d.title,
            extractedText: d.extractedText,
          })),
          preparedDocsBase64: curRag
            .filter(
              (d) =>
                d.mimeType === 'application/pdf' || d.fileName.toLowerCase().endsWith('.pdf')
            )
            .map((d) => ({
              title: d.title,
              data: d.base64Data,
            })),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedAnswer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const evt of events) {
            const line = evt.trim();
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.replace(/^data:\s*/, '');
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.responseType) {
                setTranscriptLog((prev) =>
                  prev.map((item) =>
                    item.id === itemId
                      ? {
                          ...item,
                          responseType: parsed.responseType,
                          autoDetected: Boolean(parsed.autoDetected),
                        }
                      : item
                  )
                );
              }
              if (parsed.chunk) {
                accumulatedAnswer += parsed.chunk;
                const currentText = accumulatedAnswer;
                setTranscriptLog((prev) =>
                  prev.map((item) =>
                    item.id === itemId
                      ? { ...item, spokenAnswer: currentText, isStreaming: true }
                      : item
                  )
                );
              } else if (parsed.error) {
                accumulatedAnswer += `\n[Error: ${parsed.error}]`;
              }
            } catch {
              // Ignore partial JSON frames
            }
          }
        }

        setTranscriptLog((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  spokenAnswer: accumulatedAnswer.trim() || 'No response generated.',
                  isStreaming: false,
                }
              : item
          )
        );
      } else {
        const data = await response.json();
        setTranscriptLog((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  question: data.question || cleanQuestion,
                  spokenAnswer: data.spokenAnswer || 'No response generated.',
                  responseType: data.responseType || item.responseType,
                  autoDetected:
                    typeof data.autoDetected === 'boolean' ? data.autoDetected : item.autoDetected,
                  isStreaming: false,
                }
              : item
          )
        );
      }
    } catch (err: any) {
      setTranscriptLog((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                spokenAnswer: `Unable to reach AI stream (${err?.message || 'network error'}). Please try asking again.`,
                isStreaming: false,
              }
            : item
        )
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const processSpokenQuestionRef = useRef(processSpokenQuestion);
  processSpokenQuestionRef.current = processSpokenQuestion;

  // Send recorded incoming interviewer audio segment to server for transcription + answer streaming
  const transcribeIncomingAudioBlob = async (blob: Blob) => {
    if (blob.size < 2500) return;
    setAudioStatusMsg('Verifying incoming voice question...');

    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64Audio = (reader.result as string).split(',')[1];
        if (!base64Audio) return;

        const res = await fetch('/api/interview/transcribe-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: base64Audio,
            mimeType: blob.type || 'audio/webm',
            audioModel: contextRef.current.audioModel,
            autoFallback: contextRef.current.autoFallback,
          }),
        });

        const data = await res.json();
        const transcript = (data.transcript || '').trim();
        if (isListeningRef.current) {
          setAudioStatusMsg('Listening to incoming interviewer audio...');
        }

        if (transcript.length > 3) {
          processSpokenQuestionRef.current(transcript, false);
        }
      } catch {
        if (isListeningRef.current) {
          setAudioStatusMsg('Listening to incoming interviewer audio...');
        }
      }
    };
    reader.readAsDataURL(blob);
  };

  // Capture strictly from a virtual loopback cable (Stereo Mix / VB-Cable / BlackHole) — NEVER from the physical laptop microphone
  const startVirtualLoopbackCapture = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(
        (d) =>
          d.kind === 'audioinput' &&
          d.deviceId !== 'default' &&
          d.deviceId !== 'communications' &&
          !isPhysicalMicLabel(d.label)
      );
      setAudioDevices(inputs);

      const loopback = inputs.find((d) => isVirtualLoopbackLabel(d.label));
      const targetDeviceId = selectedDeviceId || loopback?.deviceId;

      if (!targetDeviceId) {
        setIsListening(false);
        setAudioStatusMsg(
          'No Virtual Loopback cable (Stereo Mix / VB-Cable / BlackHole) detected. Switch to "System / Meeting Audio" so your laptop mic is never used.'
        );
        return false;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: targetDeviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      // Double-check the track label after permission grant to guarantee it is NOT a physical laptop microphone
      const trackLabel = stream.getAudioTracks()[0]?.label || '';
      if (isPhysicalMicLabel(trackLabel)) {
        stream.getTracks().forEach((t) => t.stop());
        await refreshAudioDevices();
        setIsListening(false);
        setAudioStatusMsg(
          `Blocked "${trackLabel}" because it is a microphone. Please select a Virtual Loopback device (Stereo Mix / VB-Cable) or use "System / Meeting Audio" so your own voice and room noise are never captured.`
        );
        return false;
      }

      await refreshAudioDevices();
      mediaStreamRef.current = stream;
      await setupVadAndRecorder(stream, stream);
      setIsListening(true);
      setActiveTab('copilot');
      setAudioStatusMsg(
        `Capturing Incoming Loopback Stream (${trackLabel || 'Virtual Cable'}) — Laptop Mic Disabled.`
      );
      return true;
    } catch {
      setIsListening(false);
      setAudioStatusMsg(
        'Could not open Virtual Loopback device. Use "System / Meeting Audio" and check "Share system/tab audio" (Laptop mic remains disabled).'
      );
      return false;
    }
  };

  // Start capturing strictly incoming interviewer audio (System/Tab Audio or Virtual Loopback Cable)
  // NEVER falls back to laptop microphone or SpeechRecognition
  const startIncomingAudioCapture = async () => {
    setAudioStatusMsg('');

    if (captureMode === 'system_audio') {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setIsListening(false);
        setAudioStatusMsg(
          'System/Tab audio capture is not supported in this browser. Please use Chrome or Edge to capture incoming meeting audio.'
        );
        return;
      }

      try {
        // Request ONLY incoming system/tab audio stream (Zoom/Teams/Meet)
        const fullDisplayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            suppressLocalAudioPlayback: false,
          } as any,
          systemAudio: 'include',
        } as any);

        const audioTracks = fullDisplayStream.getAudioTracks();
        if (audioTracks.length === 0) {
          // Stop display tracks immediately and do NOT fall back to laptop microphone
          fullDisplayStream.getTracks().forEach((t) => t.stop());
          setIsListening(false);
          setActiveTab('copilot');
          setAudioStatusMsg(
            'No incoming audio track shared! Click "Start Capturing Interviewer Audio" again and make sure to check "Also share tab/system audio" in the popup (Laptop mic is disabled so your own voice is never picked up).'
          );
          return;
        }

        const incomingAudioOnlyStream = new MediaStream(audioTracks);
        mediaStreamRef.current = fullDisplayStream;

        audioTracks[0].onended = () => {
          stopIncomingAudioCapture();
        };

        await setupVadAndRecorder(incomingAudioOnlyStream, fullDisplayStream);
        setIsListening(true);
        setActiveTab('copilot');
        setAudioStatusMsg(
          'Capturing ONLY Incoming System / Meeting Audio (Laptop Mic & Room Noise Completely Ignored).'
        );
        return;
      } catch {
        // User cancelled the screen/audio share prompt — do NOT open laptop microphone
        setIsListening(false);
        setActiveTab('copilot');
        setAudioStatusMsg(
          'Incoming audio selection cancelled. Click "Start Capturing Interviewer Audio", choose your meeting tab/window, and check "Also share tab/system audio" (Laptop mic stays off).'
        );
        return;
      }
    }

    await startVirtualLoopbackCapture();
  };

  // Vocal-Bandpass Filtered Voice Activity Detection + Utterance Recorder
  const setupVadAndRecorder = async (
    audioOnlyStream: MediaStream,
    fullStreamForSink: MediaStream
  ) => {
    // Attach full stream to hidden muted <video> element so Chromium keeps display/system audio flowing
    if (hiddenVideoSinkRef.current) {
      hiddenVideoSinkRef.current.srcObject = fullStreamForSink;
      hiddenVideoSinkRef.current.muted = true;
      try {
        await hiddenVideoSinkRef.current.play();
      } catch {}
    }

    const audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume();
      } catch {}
    }
    audioContextRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(audioOnlyStream);

    // Filter out low-frequency hum (<140Hz) and high-frequency static (>3600Hz) so only human voice triggers VAD
    const highpass = audioCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 140;

    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3600;

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 1.35;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.25;

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(gainNode);
    gainNode.connect(analyser);

    const floatData = new Float32Array(analyser.fftSize);
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    let chunks: BlobPart[] = [];
    let silenceStartMs: number | null = null;
    let speechStartMs: number = 0;
    let activeSpeechTicks: number = 0;
    let peakRmsInSegment: number = 0;
    let forceFlushRequested: boolean = false;

    const startNewRecorderCycle = () => {
      if (!isListeningRef.current && !mediaStreamRef.current) return;
      try {
        chunks = [];
        hadSpeechInSegmentRef.current = false;
        activeSpeechTicks = 0;
        peakRmsInSegment = 0;
        forceFlushRequested = false;

        const rec = new MediaRecorder(audioOnlyStream, { mimeType });
        mediaRecorderRef.current = rec;

        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        rec.onstop = () => {
          // Require genuine human speech duration (>=8 ticks = ~560ms) and clear vocal energy peak (>=0.025)
          const hasRealHumanVoice =
            forceFlushRequested ||
            (hadSpeechInSegmentRef.current &&
              activeSpeechTicks >= 8 &&
              peakRmsInSegment >= 0.025);

          const recordedChunks = [...chunks];
          chunks = [];
          hadSpeechInSegmentRef.current = false;
          activeSpeechTicks = 0;
          peakRmsInSegment = 0;
          forceFlushRequested = false;

          if (hasRealHumanVoice && recordedChunks.length > 0) {
            const blob = new Blob(recordedChunks, { type: mimeType });
            transcribeIncomingAudioBlob(blob);
          }

          // Immediately start next recorder cycle if still listening
          if (isListeningRef.current) {
            startNewRecorderCycle();
          }
        };

        rec.start(200);
      } catch {}
    };

    startNewRecorderCycle();

    // Calibrated human voice threshold on bandpass-filtered audio (ignores background hum/static)
    const FLOAT_SPEECH_THRESHOLD = 0.018;
    const SILENCE_HANGOVER_MS = 1200; // 1.2s pause after speech triggers transcription
    const MAX_SPEECH_SEGMENT_MS = 18000; // Auto-transcribe long speech every 18s
    const IDLE_RESET_MS = 3500; // Recycle silent buffer every 3.5s so dead silence is never accumulated

    let lastCycleResetMs = Date.now();

    vadIntervalRef.current = window.setInterval(() => {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      analyser.getFloatTimeDomainData(floatData);
      let sumSquares = 0;
      for (let i = 0; i < floatData.length; i++) {
        sumSquares += floatData[i] * floatData[i];
      }
      const rms = Math.sqrt(sumSquares / floatData.length);
      const uiLevel = Math.min(100, Math.round(rms * 400));
      setAudioLevel(uiLevel);

      const now = Date.now();
      const rec = mediaRecorderRef.current;

      if (rms >= FLOAT_SPEECH_THRESHOLD) {
        silenceStartMs = null;
        activeSpeechTicks += 1;
        if (rms > peakRmsInSegment) {
          peakRmsInSegment = rms;
        }
        setIsSpeakingDetected(true);

        if (!hadSpeechInSegmentRef.current) {
          hadSpeechInSegmentRef.current = true;
          speechStartMs = now;
        } else if (now - speechStartMs >= MAX_SPEECH_SEGMENT_MS) {
          speechStartMs = now;
          if (rec && rec.state === 'recording') {
            try {
              rec.stop();
            } catch {}
          }
        }
      } else {
        setIsSpeakingDetected(false);

        if (hadSpeechInSegmentRef.current) {
          if (silenceStartMs === null) {
            silenceStartMs = now;
          } else if (now - silenceStartMs >= SILENCE_HANGOVER_MS) {
            silenceStartMs = null;
            lastCycleResetMs = now;
            if (rec && rec.state === 'recording') {
              try {
                rec.stop();
              } catch {}
            }
          }
        } else if (now - lastCycleResetMs >= IDLE_RESET_MS) {
          // Periodically recycle silent buffer so pre-roll stays <3.5s with zero server calls
          lastCycleResetMs = now;
          if (rec && rec.state === 'recording') {
            try {
              rec.stop();
            } catch {}
          }
        }
      }
    }, 70);
  };

  const flushCurrentUtteranceNow = () => {
    hadSpeechInSegmentRef.current = true;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      try {
        recorder.stop();
      } catch {}
    }
  };

  const stopIncomingAudioCapture = () => {
    isListeningRef.current = false;
    setIsListening(false);

    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (hiddenVideoSinkRef.current) {
      hiddenVideoSinkRef.current.srcObject = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioLevel(0);
    setIsSpeakingDetected(false);
    setLiveTranscriptBuffer('');
    setAudioStatusMsg('');
  };

  const toggleListening = () => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      return;
    }
    if (!isListening) {
      startIncomingAudioCapture();
    } else {
      stopIncomingAudioCapture();
    }
  };

  // Handle PDF, DOCX, and TXT uploads
  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'resume' | 'jd' | 'rag'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isSupportedDocFile(file)) {
      setUploadError('Please upload a PDF (.pdf), Word (.docx), or Text (.txt) file.');
      return;
    }
    setUploadError(null);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64String = (reader.result as string).split(',')[1];

      if (type === 'resume') {
        setResumeFile({
          name: file.name,
          size: file.size,
          mimeType: file.type,
          base64: base64String,
          isIndexing: true,
        });
        try {
          const res = await fetch('/api/interview/upload-doc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'resume',
              fileName: file.name,
              mimeType: file.type,
              base64: base64String,
            }),
          });
          const data = await res.json();
          setResumeFile({
            name: file.name,
            size: file.size,
            mimeType: file.type,
            base64: base64String,
            extractedText: data.extractedText || '',
            isIndexing: false,
          });
        } catch {
          setResumeFile((prev) => (prev ? { ...prev, isIndexing: false } : null));
        }
      } else if (type === 'jd') {
        setJdFile({
          name: file.name,
          size: file.size,
          mimeType: file.type,
          base64: base64String,
          isIndexing: true,
        });
        try {
          const res = await fetch('/api/interview/upload-doc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'jd',
              fileName: file.name,
              mimeType: file.type,
              base64: base64String,
            }),
          });
          const data = await res.json();
          setJdFile({
            name: file.name,
            size: file.size,
            mimeType: file.type,
            base64: base64String,
            extractedText: data.extractedText || '',
            isIndexing: false,
          });
        } catch {
          setJdFile((prev) => (prev ? { ...prev, isIndexing: false } : null));
        }
      } else if (type === 'rag') {
        setNewDocFile({ name: file.name, mimeType: file.type, base64: base64String });
        if (!newDocTitle) {
          setNewDocTitle(file.name.replace(/\.[^/.]+$/, ''));
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const addPreparedDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocTitle || !newDocFile) return;

    const docId = Math.random().toString(36).substring(2, 9);
    const titleToSave = newDocTitle;
    const fileToSave = newDocFile;

    setNewDocTitle('');
    setNewDocFile(null);

    const newEntry: PreparedDoc = {
      id: docId,
      title: titleToSave,
      fileName: fileToSave.name,
      mimeType: fileToSave.mimeType,
      base64Data: fileToSave.base64,
      isIndexing: true,
    };

    setPreparedDocs((prev) => [...prev, newEntry]);

    try {
      const res = await fetch('/api/interview/upload-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'rag',
          id: docId,
          title: titleToSave,
          fileName: fileToSave.name,
          mimeType: fileToSave.mimeType,
          base64: fileToSave.base64,
        }),
      });
      const data = await res.json();
      setPreparedDocs((prev) =>
        prev.map((d) =>
          d.id === docId
            ? { ...d, extractedText: data.extractedText || '', isIndexing: false }
            : d
        )
      );
    } catch {
      setPreparedDocs((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, isIndexing: false } : d))
      );
    }
  };

  const removeRagDoc = async (id: string) => {
    setPreparedDocs((prev) => prev.filter((d) => d.id !== id));
    try {
      await fetch('/api/interview/remove-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'rag', id }),
      });
    } catch {}
  };

  const clearResume = async () => {
    setResumeFile(null);
    try {
      await fetch('/api/interview/remove-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'resume' }),
      });
    } catch {}
  };

  const clearJd = async () => {
    setJdFile(null);
    try {
      await fetch('/api/interview/remove-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'jd' }),
      });
    } catch {}
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    const q = manualInput.trim();
    setManualInput('');
    processSpokenQuestion(q, true);
  };

  const handleWritePythonSubmit = () => {
    const q = manualInput.trim() || transcriptLog[0]?.question || '';
    if (!q) return;
    setManualInput('');
    const pythonPrompt = /python|code|program|function|implement/i.test(q)
      ? q
      : `Write a clean Python 3 program for: ${q}`;
    processSpokenQuestion(pythonPrompt, true, 'code');
  };

  const removeQuestionCard = (id: string) => {
    setTranscriptLog((prev) => prev.filter((item) => item.id !== id));
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Render inline **bold** anchor keywords and `inline code` so eyes lock onto key phrases in <0.5s
  const renderInlineGlanceableText = (rawLine: string) => {
    const tokens = rawLine.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return tokens.map((tok, i) => {
      if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
        const inner = tok.slice(2, -2);
        return (
          <strong
            key={i}
            className="font-bold text-amber-200 bg-amber-500/15 px-1.5 py-0.5 rounded border border-amber-400/25"
          >
            {inner}
          </strong>
        );
      }
      if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
        const inner = tok.slice(1, -1);
        return (
          <code
            key={i}
            className="font-mono text-[0.9em] text-cyan-300 bg-cyan-950/70 px-1.5 py-0.5 rounded border border-cyan-500/30"
          >
            {inner}
          </code>
        );
      }
      return <React.Fragment key={i}>{tok}</React.Fragment>;
    });
  };

  // Normalize Python 3 code so it is strictly aligned in a single vertical column
  // (moves any right-hand inline `# comment` onto its own line above the statement so there is never a 2nd column)
  const formatPythonSingleColumn = (rawCode: string): string => {
    const rawLines = rawCode.replace(/\r\n/g, '\n').split('\n');
    const outLines: string[] = [];

    for (const rawLine of rawLines) {
      // Strip accidental line-number prefixes like "1: " or "1 | " if present
      const line = rawLine.replace(/^\s*\d+\s*[:|]\s/, '');
      const indentMatch = line.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';
      const trimmed = line.trim();

      // If a statement has a trailing inline comment (2+ spaces followed by #) and no string literals on the line,
      // place the comment above the statement so the Python program stays in a strict single vertical column
      if (
        trimmed &&
        !trimmed.startsWith('#') &&
        !trimmed.includes("'") &&
        !trimmed.includes('"')
      ) {
        const inlineCommentMatch = line.match(/^(\s*\S.*?)\s{2,}(#\s*.*)$/);
        if (inlineCommentMatch) {
          const codePart = inlineCommentMatch[1].trimEnd();
          const commentPart = inlineCommentMatch[2].trim();
          outLines.push(`${indent}${commentPart}`);
          outLines.push(codePart);
          continue;
        }
      }
      outLines.push(line);
    }

    return outLines.join('\n').trim();
  };

  // Glanceable Teleprompter + Single-Column Python 3 Code Renderer
  const renderGlanceableAnswer = (item: QnAItem, isCompact: boolean = false) => {
    const raw = item.spokenAnswer || '';
    if (!raw) {
      return (
        <div className="flex items-center gap-2 text-xs text-indigo-300 font-mono py-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
          <span>Synthesizing glanceable {item.responseType?.toUpperCase() || 'AUTO'} response...</span>
        </div>
      );
    }

    // Split text into non-code segments and ```python ... ``` fenced code blocks
    const segments: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(raw)) !== null) {
      if (match.index > lastIdx) {
        segments.push({ type: 'text', content: raw.slice(lastIdx, match.index) });
      }
      segments.push({
        type: 'code',
        lang: (match[1] || 'python').toLowerCase(),
        content: match[2].trim(),
      });
      lastIdx = match.index + match[0].length;
    }

    // Handle an unclosed streaming code block (while model is actively streaming Python code)
    const remaining = raw.slice(lastIdx);
    const openFenceIdx = remaining.indexOf('```');
    if (openFenceIdx !== -1) {
      if (openFenceIdx > 0) {
        segments.push({ type: 'text', content: remaining.slice(0, openFenceIdx) });
      }
      const afterFence = remaining.slice(openFenceIdx + 3);
      const firstNewline = afterFence.indexOf('\n');
      const codeBody = firstNewline !== -1 ? afterFence.slice(firstNewline + 1) : '';
      segments.push({ type: 'code', lang: 'python', content: codeBody });
    } else if (remaining.trim()) {
      segments.push({ type: 'text', content: remaining });
    }

    const baseTextClass = isCompact
      ? hudFontSize === 'lg'
        ? 'text-base leading-snug'
        : hudFontSize === 'sm'
        ? 'text-xs leading-snug'
        : 'text-sm leading-snug'
      : 'text-[15px] leading-relaxed';

    const activeMode: ResolvedAnswerType = item.responseType || 'direct';

    // When mode is CODE: Render ONLY the Python code section (no additional text or walkthroughs)
    if (activeMode === 'code') {
      const codeSegments = segments.filter((s) => s.type === 'code');
      const rawCodeContent =
        codeSegments.length > 0
          ? codeSegments.map((s) => s.content).join('\n\n')
          : raw
              .replace(/^```[a-zA-Z0-9_-]*\n?/gm, '')
              .replace(/```$/gm, '')
              .split('\n')
              .filter(
                (l) =>
                  !l.trim().startsWith('⚡') &&
                  !l.trim().startsWith('•') &&
                  !/^\*\*?(?:Approach|Walkthrough|Edge Cases|Strategy)/i.test(l.trim())
              )
              .join('\n')
              .trim();

      const codeCopyId = `${item.id}-code-only`;
      const singleColumnPython = formatPythonSingleColumn(rawCodeContent);
      const codeLines = singleColumnPython ? singleColumnPython.split('\n') : [];

      return (
        <div className="w-full max-w-full flex flex-col rounded-xl overflow-hidden border border-cyan-500/40 bg-slate-950 shadow-xl text-left">
          <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900/95 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-mono font-bold text-cyan-300">
                Python 3 Code
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                ({codeLines.length} lines)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => runPythonProgram(item.id, singleColumnPython)}
                disabled={item.isRunningPython || !singleColumnPython.trim()}
                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-md text-[11px] font-semibold transition-colors"
                title="Execute Python 3 program and view console output"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>{item.isRunningPython ? 'Running...' : 'Run Python'}</span>
              </button>
              <button
                type="button"
                onClick={() => copyToClipboard(singleColumnPython, codeCopyId)}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-[11px] font-medium border border-slate-700"
              >
                {copiedId === codeCopyId ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3 text-cyan-400" />
                )}
                <span>{copiedId === codeCopyId ? 'Copied Python' : 'Copy Code'}</span>
              </button>
            </div>
          </div>

          <div className="w-full overflow-x-auto bg-slate-950/95 p-4 text-left">
            <div className="flex flex-col items-start w-full font-mono text-xs md:text-[13px] leading-relaxed text-emerald-100">
              {codeLines.map((lineText, lineIdx) => (
                <div
                  key={lineIdx}
                  className="w-full whitespace-pre text-left select-text"
                >
                  {lineText || ' '}
                </div>
              ))}
            </div>
          </div>

          {item.pythonOutput && (
            <div className="w-full border-t border-slate-800 bg-slate-900/90 px-4 py-2.5 font-mono text-xs text-left flex flex-col gap-1">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="font-semibold text-emerald-400">
                  PYTHON 3 CONSOLE OUTPUT (STDOUT):
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setTranscriptLog((prev) =>
                      prev.map((it) =>
                        it.id === item.id ? { ...it, pythonOutput: undefined } : it
                      )
                    )
                  }
                  className="text-slate-400 hover:text-white"
                >
                  Clear
                </button>
              </div>
              <pre className="w-full text-left text-slate-100 whitespace-pre-wrap break-words">
                {item.pythonOutput}
              </pre>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3 w-full">
        {segments.map((seg, sIdx) => {
          if (seg.type === 'code') {
            const codeCopyId = `${item.id}-code-${sIdx}`;
            const singleColumnPython = formatPythonSingleColumn(seg.content);
            const codeLines = singleColumnPython ? singleColumnPython.split('\n') : [];
            return (
              <div
                key={sIdx}
                className="w-full max-w-full flex flex-col rounded-xl overflow-hidden border border-cyan-500/40 bg-slate-950 shadow-xl text-left"
              >
                <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900/95 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-xs font-mono font-bold text-cyan-300">
                      Python 3 Code
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      ({codeLines.length} lines)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => runPythonProgram(item.id, singleColumnPython)}
                      disabled={item.isRunningPython || !singleColumnPython.trim()}
                      className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-md text-[11px] font-semibold transition-colors"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>{item.isRunningPython ? 'Running...' : 'Run Python'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(singleColumnPython, codeCopyId)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-[11px] font-medium border border-slate-700"
                    >
                      {copiedId === codeCopyId ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-cyan-400" />
                      )}
                      <span>{copiedId === codeCopyId ? 'Copied Python' : 'Copy Code'}</span>
                    </button>
                  </div>
                </div>

                <div className="w-full overflow-x-auto bg-slate-950/95 p-4 text-left">
                  <div className="flex flex-col items-start w-full font-mono text-xs md:text-[13px] leading-relaxed text-emerald-100">
                    {codeLines.map((lineText, lineIdx) => (
                      <div
                        key={lineIdx}
                        className="w-full whitespace-pre text-left select-text"
                      >
                        {lineText || ' '}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          const isDirectMode = activeMode === 'direct';
          const isHintMode = activeMode === 'hint';
          const lines = seg.content
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);

          return (
            <div key={sIdx} className="flex flex-col gap-2.5">
              {lines.map((line, lIdx) => {
                // HINT mode: Just hints in clean bullets
                if (isHintMode) {
                  const cleanHint = line
                    .replace(/^⚡\s*/, '')
                    .replace(/^[•\-*]\s+/, '')
                    .replace(
                      /^\*\*?(?:Core Hook|Key Point \d+|Hint \d+|Resume \/ (?:JD \/ Q&A |Metric )?Tie-In)\s*:?\*\*?\s*:?\s*/i,
                      ''
                    )
                    .trim();
                  if (!cleanHint) return null;
                  return (
                    <div
                      key={lIdx}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-900/75 border border-amber-500/25 flex items-start gap-2.5 text-left"
                    >
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 mt-2" />
                      <div className={`${baseTextClass} text-slate-100`}>
                        {renderInlineGlanceableText(cleanHint)}
                      </div>
                    </div>
                  );
                }

                // DIRECT mode: Complete spoken paragraphs without meta-labels
                if (isDirectMode && !/^\[([STAR])\]/i.test(line)) {
                  const directClean = line
                    .replace(/^⚡\s*/, '')
                    .replace(/^[•\-*]\s+/, '')
                    .replace(
                      /^\*\*?(?:Headline|Core Takeaway|Opening|Summary|Key Pillar \d+|Real Impact(?: \/ Example)?|Experience|In Practice|Why Here|Architecture|Production Impact)\s*:?\*\*?\s*:?\s*/i,
                      ''
                    )
                    .trim();

                  return (
                    <div
                      key={lIdx}
                      className="p-3.5 rounded-xl bg-slate-900/80 border-l-4 border-indigo-500 border-y border-r border-slate-800/90 text-left shadow-sm"
                    >
                      <div
                        className={`${
                          isCompact
                            ? baseTextClass
                            : 'text-[15.5px] md:text-base leading-relaxed'
                        } text-slate-50 font-normal tracking-wide select-text`}
                      >
                        {renderInlineGlanceableText(directClean || line)}
                      </div>
                    </div>
                  );
                }

                // STAR Method Badge Rows ([S], [T], [A], [R])
                const starMatch = line.match(/^\[([STAR])\]\s*(.*)$/i);
                if (starMatch) {
                  const letter = starMatch[1].toUpperCase();
                  const body = starMatch[2];
                  const starColors: Record<string, string> = {
                    S: 'bg-indigo-600/30 text-indigo-200 border-indigo-500/50',
                    T: 'bg-amber-600/30 text-amber-200 border-amber-500/50',
                    A: 'bg-emerald-600/30 text-emerald-200 border-emerald-500/50',
                    R: 'bg-cyan-600/30 text-cyan-200 border-cyan-500/50',
                  };
                  return (
                    <div
                      key={lIdx}
                      className="p-2.5 rounded-xl bg-slate-900/85 border border-slate-800 flex items-start gap-2.5"
                    >
                      <span
                        className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold border shrink-0 mt-0.5 ${
                          starColors[letter] || starColors.S
                        }`}
                      >
                        {letter}
                      </span>
                      <div className={`${baseTextClass} text-slate-100`}>
                        {renderInlineGlanceableText(body)}
                      </div>
                    </div>
                  );
                }

                // Glanceable Bullet Point Cue (• or - or *)
                if (/^[•\-*]\s+/.test(line)) {
                  const cleanBullet = line.replace(/^[•\-*]\s+/, '');
                  return (
                    <div
                      key={lIdx}
                      className="px-3 py-2 rounded-xl bg-slate-900/65 border border-slate-800/90 flex items-start gap-2.5"
                    >
                      <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0 mt-2" />
                      <div className={`${baseTextClass} text-slate-100`}>
                        {renderInlineGlanceableText(cleanBullet)}
                      </div>
                    </div>
                  );
                }

                // Default spoken line
                return (
                  <div
                    key={lIdx}
                    className={`p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 ${baseTextClass} text-slate-100`}
                  >
                    {renderInlineGlanceableText(line)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  const exportSessionReport = () => {
    const markdown =
      `# Tackelo AI - Interview Spoken Script Report\nGenerated: ${new Date().toLocaleString()}\n\n` +
      transcriptLog
        .map(
          (item, idx) =>
            `## Question ${transcriptLog.length - idx} [${(item.responseType || 'direct').toUpperCase()}]: ${item.question}\n\n**Glanceable Response:**\n${item.spokenAnswer}\n\n---\n`
        )
        .join('\n');

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tackelo-ai-spoken-script-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Draw live streaming question, glanceable cues & single-column Python 3 code onto Canvas for Always-On-Top PiP HUD Window
  const drawHudCanvasFrame = React.useCallback(() => {
    const canvas = hudCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // Translucent dark HUD background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = `rgba(2, 6, 23, ${Math.max(0.4, opacity)})`;
    ctx.fillRect(0, 0, W, H);

    // Top HUD Header Bar
    ctx.fillStyle = 'rgba(30, 27, 75, 0.95)';
    ctx.fillRect(0, 0, W, 50);
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 50);
    ctx.lineTo(W, 50);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
    ctx.fillText('Tackelo AI · Always-On-Top HUD', 18, 31);

    // Audio Status Pill on right of header
    ctx.fillStyle = isListening
      ? isSpeakingDetected
        ? '#34d399'
        : '#818cf8'
      : '#94a3b8';
    ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const statusLabel = isListening
      ? isSpeakingDetected
        ? '● INTERVIEWER SPEAKING...'
        : '● LISTENING (INCOMING AUDIO)'
      : '○ READY';
    ctx.fillText(statusLabel, W - ctx.measureText(statusLabel).width - 18, 31);

    const latest = transcriptLog[0];
    if (!latest) {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 20px system-ui, -apple-system, sans-serif';
      ctx.fillText('Always-On-Top HUD Active & Ready', 26, 120);
      ctx.font = '400 16px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(
        'Auto-Detects: DIRECT · HINT · STAR · CODE (Python 3)',
        26,
        158
      );
      ctx.fillText(
        'Keep this window on top while interacting with Zoom, Teams, Meet, or your IDE.',
        26,
        188
      );
      return;
    }

    // Draw Question Box + Detected Type Badge
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(16, 60, W - 32, 54);
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
    ctx.strokeRect(16, 60, W - 32, 54);

    const badgeText = `[${latest.autoDetected ? 'AUTO → ' : ''}${(
      latest.responseType || 'direct'
    ).toUpperCase()}] `;
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText(badgeText, 28, 93);
    const badgeWidth = ctx.measureText(badgeText).width;

    ctx.fillStyle = '#a5b4fc';
    ctx.font = 'bold 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const qPrefix = `Q: "${latest.question}"`;
    const maxQWidth = W - 60 - badgeWidth;
    let qLine = qPrefix;
    if (ctx.measureText(qLine).width > maxQWidth) {
      while (qLine.length > 10 && ctx.measureText(qLine + '..."').width > maxQWidth) {
        qLine = qLine.slice(0, -1);
      }
      qLine += '..."';
    }
    ctx.fillText(qLine, 28 + badgeWidth, 93);

    // Build structured render rows preserving single-column Python code indentation
    const rawAnswer =
      latest.spokenAnswer || (latest.isStreaming ? 'Synthesizing response...' : '');

    type CanvasRow = {
      text: string;
      kind: 'hook' | 'star' | 'code-header' | 'code' | 'bullet' | 'text';
    };
    const rows: CanvasRow[] = [];

    const fontPx = hudFontSize === 'lg' ? 21 : hudFontSize === 'sm' ? 15 : 18;
    const codeFontPx = hudFontSize === 'lg' ? 18 : hudFontSize === 'sm' ? 14 : 16;
    const maxLineWidth = W - 56;

    // Split into text and fenced code blocks just like renderGlanceableAnswer
    const fenceRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    const parts: Array<{ type: 'text' | 'code'; content: string }> = [];

    while ((m = fenceRegex.exec(rawAnswer)) !== null) {
      if (m.index > lastIndex) {
        parts.push({ type: 'text', content: rawAnswer.slice(lastIndex, m.index) });
      }
      parts.push({ type: 'code', content: formatPythonSingleColumn(m[2]) });
      lastIndex = m.index + m[0].length;
    }
    const tail = rawAnswer.slice(lastIndex);
    const openFence = tail.indexOf('```');
    if (openFence !== -1) {
      if (openFence > 0) {
        parts.push({ type: 'text', content: tail.slice(0, openFence) });
      }
      const afterFence = tail.slice(openFence + 3);
      const nl = afterFence.indexOf('\n');
      parts.push({
        type: 'code',
        content: formatPythonSingleColumn(nl !== -1 ? afterFence.slice(nl + 1) : ''),
      });
    } else if (tail.trim()) {
      parts.push({ type: 'text', content: tail });
    }

    const isCodeOnlyMode = (latest.responseType || 'direct') === 'code';

    for (const part of parts) {
      if (part.type === 'code' || isCodeOnlyMode) {
        if (isCodeOnlyMode && part.type === 'text' && parts.some((p) => p.type === 'code')) {
          // Skip any non-code text in Code mode when code block exists
          continue;
        }
        const codeLines = formatPythonSingleColumn(part.content).split('\n');
        for (const cLine of codeLines) {
          rows.push({ text: cLine, kind: 'code' });
        }
      } else {
        ctx.font = `600 ${fontPx}px system-ui, -apple-system, sans-serif`;
        const rawLines = part.content
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        for (const rLine of rawLines) {
          const cleanLine = rLine.replace(/\*\*/g, '').replace(/`/g, '');
          const kind: CanvasRow['kind'] = cleanLine.startsWith('⚡')
            ? 'hook'
            : /^\[[STAR]\]/i.test(cleanLine)
            ? 'star'
            : /^[•\-*]/.test(cleanLine)
            ? 'bullet'
            : 'text';

          const words = cleanLine.split(/\s+/);
          let currentLine = '';
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (ctx.measureText(testLine).width > maxLineWidth && currentLine) {
              rows.push({ text: currentLine, kind });
              currentLine = '   ' + word;
            } else {
              currentLine = testLine;
            }
          }
          if (currentLine) rows.push({ text: currentLine, kind });
        }
      }
    }

    const lineHeight = Math.round(fontPx * 1.42);
    const availableHeight = H - 145;
    const maxVisibleRows = Math.max(1, Math.floor(availableHeight / lineHeight));
    const maxStartIdx = Math.max(0, rows.length - maxVisibleRows);
    const clampedStart = Math.min(Math.max(0, hudScrollLine), maxStartIdx);
    const visibleRows = rows.slice(clampedStart, clampedStart + maxVisibleRows);

    let y = 144;
    for (const row of visibleRows) {
      if (row.kind === 'code') {
        ctx.fillStyle = 'rgba(8, 47, 73, 0.45)';
        ctx.fillRect(20, y - lineHeight + 6, W - 40, lineHeight);
        ctx.font = `500 ${codeFontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.fillStyle = row.text.trim().startsWith('#') ? '#94a3b8' : '#a7f3d0';
        ctx.fillText(row.text, 28, y);
      } else if (row.kind === 'code-header') {
        ctx.font = `bold ${codeFontPx - 1}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(row.text, 24, y);
      } else {
        ctx.font = `600 ${fontPx}px system-ui, -apple-system, sans-serif`;
        ctx.fillStyle =
          row.kind === 'hook'
            ? '#fde68a'
            : row.kind === 'star'
            ? '#6ee7b7'
            : '#f8fafc';
        ctx.fillText(row.text, 24, y);
      }
      y += lineHeight;
    }

    // Bottom Scroll Footer if content exceeds 1 screen
    if (rows.length > maxVisibleRows) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.fillRect(0, H - 28, W, 28);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      const footerText = `Showing lines ${clampedStart + 1}–${Math.min(
        rows.length,
        clampedStart + maxVisibleRows
      )} of ${rows.length} · Use ⏮ / ⏭ or Scroll Up/Down controls`;
      ctx.fillText(footerText, 24, H - 9);
    }
  }, [transcriptLog, isListening, isSpeakingDetected, opacity, hudFontSize, hudScrollLine]);

  // Keep offscreen HUD canvas + video stream continuously warm so OS Picture-in-Picture opens on the very first click
  useEffect(() => {
    drawHudCanvasFrame();
  }, [drawHudCanvasFrame]);

  useEffect(() => {
    const canvas = hudCanvasRef.current;
    const video = hudVideoRef.current;
    if (!canvas || !video) return;

    drawHudCanvasFrame();

    try {
      if (!video.srcObject && typeof (canvas as any).captureStream === 'function') {
        const stream = (canvas as any).captureStream(30);
        if (stream) {
          video.srcObject = stream;
          video.play().catch(() => {});
        }
      }
    } catch {}

    const keepWarmTimer = window.setInterval(() => {
      drawHudCanvasFrame();
      if (video.paused && video.srcObject) {
        video.play().catch(() => {});
      }
    }, 350);

    return () => {
      window.clearInterval(keepWarmTimer);
    };
  }, [drawHudCanvasFrame]);

  // Register MediaSession ⏮ / ⏭ handlers so users can scroll Python code directly inside the floating PiP window
  useEffect(() => {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          setHudScrollLine((prev) => Math.max(0, prev - 4));
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          setHudScrollLine((prev) => prev + 4);
        });
      } catch {}
    }
  }, []);

  // Support keyboard ArrowUp / ArrowDown to scroll the Always-On-Top HUD
  useEffect(() => {
    if (!isVideoPipActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHudScrollLine((prev) => prev + 3);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHudScrollLine((prev) => Math.max(0, prev - 3));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isVideoPipActive]);

  // Handle dragging the in-page translucent HUD panel
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragOffsetRef.current) return;
      const dx = e.clientX - dragOffsetRef.current.startX;
      const dy = e.clientY - dragOffsetRef.current.startY;
      setHudPosition({
        x: Math.max(8, Math.min(window.innerWidth - 320, dragOffsetRef.current.origX + dx)),
        y: Math.max(8, Math.min(window.innerHeight - 100, dragOffsetRef.current.origY + dy)),
      });
    };
    const handleMouseUp = () => {
      dragOffsetRef.current = null;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Open a true separate OS-level Always-On-Top Floating HUD Window
  // 1) Uses Document Picture-in-Picture if supported in top-level tab
  // 2) Uses pre-warmed Video Picture-in-Picture (works inside iframes and floats on top of Zoom/Teams/IDE)
  // 3) Falls back to Translucent Glass Overlay HUD only if OS PiP is unavailable
  const openSeparateAlwaysOnTopHud = async () => {
    // 1. Try Document Picture-in-Picture API (top-level interactive Always-On-Top window)
    const docPip = (window as any).documentPictureInPicture;
    if (docPip && typeof docPip.requestWindow === 'function') {
      try {
        if (pipWindowRef.current && !pipWindowRef.current.closed) {
          pipWindowRef.current.focus();
          setIsFloatingMode(false);
          return;
        }
        const pipWin: Window = await docPip.requestWindow({
          width: 500,
          height: 620,
        });
        pipWindowRef.current = pipWin;
        pipWin.document.title = 'Tackelo AI — Floating HUD';

        Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).forEach((node) => {
          pipWin.document.head.appendChild(node.cloneNode(true));
        });

        pipWin.document.body.style.margin = '0';
        pipWin.document.body.style.backgroundColor = 'rgb(2, 6, 23)';
        pipWin.document.body.style.color = 'rgb(241, 245, 249)';
        pipWin.document.body.style.overflow = 'auto';

        const container = pipWin.document.createElement('div');
        container.id = 'tackelo-pip-root';
        pipWin.document.body.appendChild(container);
        setPipContainer(container);
        setIsFloatingMode(false);
        setIsVideoPipActive(false);

        pipWin.addEventListener('pagehide', () => {
          setPipContainer(null);
          pipWindowRef.current = null;
          setIsFloatingMode(false);
        });
        return;
      } catch {
        // Proceed immediately to pre-warmed Video Picture-in-Picture
      }
    }

    // 2. Always-On-Top OS Video Picture-in-Picture Window (works inside iframes and floats over all OS apps)
    try {
      const canvas = hudCanvasRef.current;
      const video = hudVideoRef.current;
      if (canvas && video && typeof (video as any).requestPictureInPicture === 'function') {
        drawHudCanvasFrame();

        if (document.pictureInPictureElement) {
          setIsVideoPipActive(true);
          setIsFloatingMode(false);
          return;
        }

        if (!video.srcObject && typeof (canvas as any).captureStream === 'function') {
          const stream = (canvas as any).captureStream(30);
          if (stream) {
            video.srcObject = stream;
          }
        }

        if (video.paused) {
          await video.play();
        }

        // Ensure metadata is ready before requesting PiP
        if (video.readyState < 1) {
          await new Promise<void>((resolve) => {
            const onReady = () => {
              video.removeEventListener('loadedmetadata', onReady);
              resolve();
            };
            video.addEventListener('loadedmetadata', onReady);
            drawHudCanvasFrame();
            setTimeout(() => {
              video.removeEventListener('loadedmetadata', onReady);
              resolve();
            }, 300);
          });
        }

        video.onleavepictureinpicture = () => {
          setIsVideoPipActive(false);
        };

        await (video as any).requestPictureInPicture();
        setIsVideoPipActive(true);
        setIsFloatingMode(false);
        return;
      }
    } catch {
      // Fallback to in-page draggable translucent HUD if browser disables PiP
    }

    // 3. Fallback: Draggable Translucent Glass HUD
    setIsFloatingMode(true);
  };

  const openTranslucentOverlayHud = async () => {
    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
      } catch {}
    }
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      try {
        pipWindowRef.current.close();
      } catch {}
      pipWindowRef.current = null;
      setPipContainer(null);
    }
    setIsVideoPipActive(false);
    setIsFloatingMode(true);
  };

  const closeFloatingHud = async () => {
    setIsFloatingMode(false);
    setIsVideoPipActive(false);
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      try {
        pipWindowRef.current.close();
      } catch {}
      pipWindowRef.current = null;
      setPipContainer(null);
    }
    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
      } catch {}
    }
  };

  const toggleFloatingHud = () => {
    if (isFloatingMode || pipContainer || isVideoPipActive) {
      closeFloatingHud();
    } else {
      openSeparateAlwaysOnTopHud();
    }
  };

  const renderHudContent = (isInsideSeparateWindow: boolean) => {
    const textSizeClass =
      hudFontSize === 'lg'
        ? 'text-lg leading-relaxed'
        : hudFontSize === 'sm'
        ? 'text-xs leading-relaxed'
        : 'text-sm leading-relaxed';

    return (
      <div
        className="flex flex-col h-full text-slate-100 font-sans select-text"
        style={{
          backgroundColor: `rgba(2, 6, 23, ${opacity})`,
          backdropFilter: 'blur(16px)',
        }}
      >
        {/* Top Draggable / Control Header */}
        <div
          onMouseDown={(e) => {
            if (isInsideSeparateWindow) return;
            if ((e.target as HTMLElement).closest('button, input, select')) return;
            dragOffsetRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              origX: hudPosition.x,
              origY: hudPosition.y,
            };
          }}
          className={`flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-indigo-500/30 bg-slate-900/75 ${
            !isInsideSeparateWindow ? 'cursor-move' : ''
          }`}
        >
          <div className="flex items-center gap-2">
            {!isInsideSeparateWindow && <Move className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
            <span className="text-xs font-bold tracking-tight text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Tackelo <span className="text-indigo-400">HUD</span>
            </span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                isListening
                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {isListening
                ? isSpeakingDetected
                  ? 'SPEAKING'
                  : 'LIVE AUDIO'
                : 'READY'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {!isInsideSeparateWindow && (
              <button
                type="button"
                onClick={openSeparateAlwaysOnTopHud}
                className="flex items-center gap-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-semibold shadow"
                title="Pop out into a separate Always-On-Top OS window so you can interact with other screens"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Always-On-Top Window</span>
              </button>
            )}
            {!isInsideSeparateWindow && (
              <button
                type="button"
                onClick={() => setIsHudMinimized(!isHudMinimized)}
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                title={isHudMinimized ? 'Expand HUD' : 'Minimize HUD'}
              >
                {isHudMinimized ? (
                  <Maximize2 className="w-3.5 h-3.5" />
                ) : (
                  <Minimize2 className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={closeFloatingHud}
              className="px-2 py-1 bg-slate-800 hover:bg-rose-600 text-slate-200 hover:text-white rounded text-[11px] font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {!isHudMinimized && (
          <>
            {/* Transparency, Text Size & Audio Quick Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-slate-800/80 bg-slate-950/50 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Glass:</span>
                <input
                  type="range"
                  min="0.15"
                  max="1.0"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  className="w-20 accent-indigo-500"
                  title="Adjust HUD transparency to see screens behind it"
                />
                <span className="font-mono text-indigo-300 w-8">
                  {Math.round(opacity * 100)}%
                </span>
              </div>

              <div className="flex items-center gap-1">
                {(['sm', 'base', 'lg'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setHudFontSize(sz)}
                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                      hudFontSize === sz
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sz.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`px-2.5 py-1 rounded font-semibold text-[11px] ${
                    isListening
                      ? 'bg-rose-600 hover:bg-rose-500 text-white'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  {isListening ? 'Stop Audio' : 'Capture Audio'}
                </button>
                {isListening && (
                  <button
                    type="button"
                    onClick={flushCurrentUtteranceNow}
                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold text-[11px]"
                  >
                    Answer Now
                  </button>
                )}
              </div>
            </div>

            {/* Quick Manual Question Input + Write Python Button */}
            <form
              onSubmit={handleManualSubmit}
              className="flex flex-col gap-1.5 px-3.5 py-2 border-b border-slate-800/80"
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Type question or Python task..."
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="flex-1 bg-slate-900/80 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shrink-0"
                >
                  Ask
                </button>
                <button
                  type="button"
                  onClick={handleWritePythonSubmit}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold shrink-0"
                  title="Write a Python 3 program for this question"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Python</span>
                </button>
              </div>
              {/* Response Type Bar in Floating HUD */}
              <div className="flex items-center justify-between gap-1 pt-1">
                <span className="text-[10px] text-slate-400 font-medium">Mode:</span>
                <div className="flex items-center gap-1">
                  {(['auto', 'direct', 'hint', 'star', 'code'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setAnswerStyle(mode);
                        saveAppSettings({ answerStyle: mode });
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase transition-colors ${
                        answerStyle === mode
                          ? 'bg-indigo-600 text-white font-bold'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mode === 'auto' ? 'Auto' : mode}
                    </button>
                  ))}
                </div>
              </div>
            </form>

            {/* Live Streaming Glanceable Answer Teleprompter */}
            <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3 max-h-[390px]">
              {transcriptLog.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-300 flex flex-col items-center gap-2">
                  <p className="font-semibold text-white">
                    Glanceable Teleprompter Active (Auto: Direct · Hint · STAR · Code)
                  </p>
                  <p className="text-[11px] text-slate-400 max-w-xs">
                    Agent automatically identifies the answer type for each question (Direct, Hint, STAR, Code).
                  </p>
                </div>
              ) : (
                transcriptLog.map((item) => {
                  const rType: ResolvedAnswerType = item.responseType || 'direct';
                  const meta = RESPONSE_TYPE_META[rType];
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl p-3.5 border border-indigo-500/30 flex flex-col gap-2.5"
                      style={{ backgroundColor: `rgba(15, 23, 42, ${Math.min(0.94, opacity + 0.12)})` }}
                    >
                      <div className="flex flex-col gap-1.5 border-b border-slate-800/80 pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${meta.badgeClass}`}
                          >
                            {item.autoDetected ? `AUTO → ${meta.shortLabel}` : meta.shortLabel}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {(['direct', 'hint', 'star', 'code'] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() =>
                                  processSpokenQuestion(item.question, true, t, item.id)
                                }
                                className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase border ${
                                  rType === t
                                    ? 'bg-indigo-600 text-white border-indigo-400'
                                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                                }`}
                                title={`Switch response to ${t.toUpperCase()}`}
                              >
                                {t}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => copyToClipboard(item.spokenAnswer, item.id)}
                              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px]"
                            >
                              {copiedId === item.id ? 'Copied' : 'Copy'}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeQuestionCard(item.id)}
                              className="p-1 text-slate-400 hover:text-rose-400"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <span className="text-xs font-mono text-indigo-300 truncate">
                          Q: &ldquo;{item.question}&rdquo;
                        </span>
                      </div>
                      {renderGlanceableAnswer(item, true)}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Hidden active video sink required by Chromium so getDisplayMedia system/tab audio tracks are never suspended */}
      <video ref={hiddenVideoSinkRef} className="hidden" muted playsInline autoPlay />

      {/* Offscreen active canvas + video stream (must NOT be display:none so Chromium decodes frames for instant Always-On-Top PiP) */}
      <canvas
        ref={hudCanvasRef}
        width={820}
        height={540}
        className="fixed -left-[9999px] -top-[9999px] pointer-events-none opacity-0"
      />
      <video
        ref={hudVideoRef}
        muted
        playsInline
        autoPlay
        className="fixed -left-[9999px] -top-[9999px] w-4 h-4 pointer-events-none opacity-0"
      />

      {/* Entry Access Authentication Popup Modal */}
      {(!isAuthenticated || isAuthModalOpen) && (
        <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-indigo-500/40 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Popup Header */}
            <div className="px-6 py-4 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <Lock className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <span>Tackelo AI</span>
                    <span className="text-indigo-400">· Access</span>
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Enter your authentication code to continue
                  </p>
                </div>
              </div>
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Popup Body */}
            <form
              onSubmit={handleAuthenticateSubmit}
              className="p-6 flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Authentication Code</span>
                </label>
                <div className="relative">
                  <input
                    type={showAuthCode ? 'text' : 'password'}
                    inputMode="numeric"
                    autoFocus
                    placeholder="Enter access code..."
                    value={authCodeInput}
                    onChange={(e) => {
                      setAuthCodeInput(e.target.value);
                      if (authError) setAuthError('');
                    }}
                    className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 pr-10 text-sm font-mono tracking-widest text-white placeholder-slate-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAuthCode(!showAuthCode)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    tabIndex={-1}
                  >
                    {showAuthCode ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {authError && (
                  <p className="text-xs text-rose-400 font-medium">{authError}</p>
                )}
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all"
              >
                Authenticate
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Portal into Separate Always-On-Top Document Picture-in-Picture Window */}
      {isAuthenticated && pipContainer && createPortal(renderHudContent(true), pipContainer)}

      {/* Non-blocking Click-Through Draggable Translucent HUD Overlay (strictly 1 HUD at a time) */}
      {isAuthenticated && isFloatingMode && !pipContainer && !isVideoPipActive && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <div
            style={{ left: `${hudPosition.x}px`, top: `${hudPosition.y}px` }}
            className="fixed w-[460px] max-w-[94vw] rounded-2xl border border-indigo-500/50 shadow-2xl overflow-hidden pointer-events-auto"
          >
            {renderHudContent(false)}
          </div>
        </div>
      )}

      {/* Top Bar Contract */}
      <div
        className={
          !isAuthenticated
            ? 'pointer-events-none select-none blur-md opacity-40 flex-1 flex flex-col'
            : 'flex-1 flex flex-col'
        }
      >
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
              aria-label="Toggle navigation menu"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
              <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-white" />
            </div>
            <span className="text-base md:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
              Tackelo <span className="text-indigo-400">AI</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <button
              onClick={() => setActiveTab('setup')}
              className={`transition-colors whitespace-nowrap shrink-0 pb-1 border-b-2 ${
                activeTab === 'setup'
                  ? 'text-white border-indigo-500'
                  : 'border-transparent hover:text-slate-200'
              }`}
            >
              1. Document Uploads
            </button>
            <button
              onClick={() => setActiveTab('copilot')}
              className={`transition-colors whitespace-nowrap shrink-0 pb-1 border-b-2 flex items-center gap-1.5 ${
                activeTab === 'copilot'
                  ? 'text-white border-indigo-500'
                  : 'border-transparent hover:text-slate-200'
              }`}
            >
              2. Live Spoken HUD
              {transcriptLog.length > 0 && (
                <span className="text-indigo-400 text-xs font-mono tabular-nums">
                  ({transcriptLog.length})
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`transition-colors whitespace-nowrap shrink-0 pb-1 border-b-2 ${
                activeTab === 'history'
                  ? 'text-white border-indigo-500'
                  : 'border-transparent hover:text-slate-200'
              }`}
            >
              3. History & Export
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`transition-colors whitespace-nowrap shrink-0 pb-1 border-b-2 flex items-center gap-1.5 ${
                activeTab === 'settings'
                  ? 'text-white border-indigo-500'
                  : 'border-transparent hover:text-slate-200'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>4. Settings & Models</span>
            </button>
          </nav>

          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <button
              type="button"
              onClick={lockApplication}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
              title="Lock app (require access code 2507)"
            >
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Lock</span>
            </button>

            <button
              onClick={toggleFloatingHud}
              className={`flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                isFloatingMode || pipContainer || isVideoPipActive
                  ? 'text-indigo-200 bg-indigo-950/80 border-indigo-500/60 hover:bg-indigo-900/70'
                  : 'text-slate-300 bg-slate-800 hover:bg-slate-700 border-slate-700'
              }`}
              title="Pop out a translucent Always-On-Top Floating HUD window so you can interact with other screens"
            >
              {isFloatingMode || pipContainer || isVideoPipActive ? (
                <EyeOff className="w-3.5 h-3.5 text-indigo-400" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span className="hidden sm:inline">
                {isFloatingMode || pipContainer || isVideoPipActive
                  ? 'Close Floating HUD'
                  : 'Pop-Out Floating HUD'}
              </span>
              <span className="sm:hidden">HUD</span>
            </button>

            {!isListening ? (
              <button
                onClick={toggleListening}
                className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-lg shadow-indigo-600/30 transition-all whitespace-nowrap"
              >
                <MonitorSpeaker className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Capture Incoming Audio</span>
                <span className="sm:hidden">Capture</span>
              </button>
            ) : (
              <button
                onClick={toggleListening}
                className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg shadow-lg shadow-rose-600/30 transition-all whitespace-nowrap"
              >
                <Square className="w-4 h-4 fill-current shrink-0" />
                <span className="hidden sm:inline">Stop Audio Capture</span>
                <span className="sm:hidden">Stop</span>
              </button>
            )}
          </div>
        </div>

        {/* Always-visible scrollable mobile tab strip (< md) */}
        <nav className="flex md:hidden items-center gap-2 px-4 py-2 border-t border-slate-800/70 bg-slate-950/60 overflow-x-auto no-scrollbar text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setActiveTab('setup');
              setIsMobileMenuOpen(false);
            }}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'setup'
                ? 'bg-indigo-600 text-white font-semibold'
                : 'text-slate-300 bg-slate-900/80 hover:text-white'
            }`}
          >
            1. Document Uploads
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('copilot');
              setIsMobileMenuOpen(false);
            }}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 transition-colors flex items-center gap-1 ${
              activeTab === 'copilot'
                ? 'bg-indigo-600 text-white font-semibold'
                : 'text-slate-300 bg-slate-900/80 hover:text-white'
            }`}
          >
            <span>2. Live Spoken HUD</span>
            {transcriptLog.length > 0 && (
              <span className="text-[11px] font-mono">({transcriptLog.length})</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('history');
              setIsMobileMenuOpen(false);
            }}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'history'
                ? 'bg-indigo-600 text-white font-semibold'
                : 'text-slate-300 bg-slate-900/80 hover:text-white'
            }`}
          >
            3. History & Export
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('settings');
              setIsMobileMenuOpen(false);
            }}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 transition-colors flex items-center gap-1 ${
              activeTab === 'settings'
                ? 'bg-indigo-600 text-white font-semibold'
                : 'text-slate-300 bg-slate-900/80 hover:text-white'
            }`}
          >
            <Settings className="w-3 h-3" />
            <span>4. Settings & Models</span>
          </button>
        </nav>

        {/* Expandable Mobile Menu Drawer when hamburger button is tapped */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-slate-800 bg-slate-900/95 px-4 py-3 flex flex-col gap-1.5 shadow-2xl">
            <button
              type="button"
              onClick={() => {
                setActiveTab('setup');
                setIsMobileMenuOpen(false);
              }}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between ${
                activeTab === 'setup'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span>1. Document Uploads (Resume · JD · Q&A)</span>
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('copilot');
                setIsMobileMenuOpen(false);
              }}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between ${
                activeTab === 'copilot'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span>
                2. Live Spoken HUD {transcriptLog.length > 0 ? `(${transcriptLog.length})` : ''}
              </span>
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('history');
                setIsMobileMenuOpen(false);
              }}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between ${
                activeTab === 'history'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span>3. History & Export Script</span>
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('settings');
                setIsMobileMenuOpen(false);
              }}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between ${
                activeTab === 'settings'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5" />
                <span>4. Settings & Suggested Models</span>
              </span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 flex flex-col gap-6">
        {/* Active Separate Always-On-Top HUD Window Remote Control Bar */}
        {isAuthenticated && (isVideoPipActive || pipContainer) && (
          <div className="bg-indigo-950/60 border border-indigo-500/50 rounded-2xl p-3.5 px-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <div className="text-xs">
                <span className="font-bold text-white">
                  Separate Always-On-Top HUD Window Active
                </span>
                <span className="text-indigo-200 ml-2 hidden sm:inline">
                  Floats over Zoom, Teams, Meet &amp; coding screens while you interact with other windows.
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isVideoPipActive && (
                <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-700 rounded-lg p-1">
                  <button
                    type="button"
                    onClick={() => setHudScrollLine((prev) => Math.max(0, prev - 4))}
                    className="px-2 py-1 text-[11px] font-mono text-slate-200 hover:bg-slate-800 rounded"
                    title="Scroll Up in Always-On-Top HUD (or press Up Arrow)"
                  >
                    ↑ Scroll Up
                  </button>
                  <button
                    type="button"
                    onClick={() => setHudScrollLine(0)}
                    className="px-2 py-1 text-[11px] font-mono text-indigo-300 hover:bg-slate-800 rounded"
                    title="Jump to Top of Python Program / Answer"
                  >
                    Top
                  </button>
                  <button
                    type="button"
                    onClick={() => setHudScrollLine((prev) => prev + 4)}
                    className="px-2 py-1 text-[11px] font-mono text-slate-200 hover:bg-slate-800 rounded"
                    title="Scroll Down in Always-On-Top HUD (or press Down Arrow)"
                  >
                    ↓ Scroll Down
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={openTranslucentOverlayHud}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700"
                title="Switch to in-page draggable translucent glass overlay"
              >
                Switch to Translucent Glass Overlay
              </button>

              <button
                type="button"
                onClick={closeFloatingHud}
                className="px-2.5 py-1.5 bg-rose-600/80 hover:bg-rose-600 text-white rounded-lg text-xs font-semibold"
              >
                Close HUD Window
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <div className="bg-rose-950/50 border border-rose-500/40 rounded-xl p-3 text-xs text-rose-300 flex items-center justify-between">
            <span>{uploadError}</span>
            <button onClick={() => setUploadError(null)} className="text-rose-400 font-semibold">
              Dismiss
            </button>
          </div>
        )}

        {/* Tab 1: Document Uploads (PDF, DOCX, TXT) */}
        {activeTab === 'setup' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Resume */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <User className="w-5 h-5 text-indigo-400" />
                    <h2 className="text-base font-bold text-white">Candidate Resume</h2>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">PDF · DOCX · TXT</span>
                </div>
                {resumeFile ? (
                  <div className="p-3 bg-slate-950 border border-indigo-500/30 rounded-xl flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white truncate">
                        {resumeFile.name}
                      </span>
                      <button
                        onClick={clearResume}
                        className="text-slate-400 hover:text-rose-400 text-xs shrink-0 ml-2"
                      >
                        Change
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      {resumeFile.isIndexing ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
                          <span className="text-amber-300">Extracting resume...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Indexed & ready for instant answers</span>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <label className="border-2 border-dashed border-slate-800 hover:border-indigo-500/50 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer bg-slate-950/40">
                    <Upload className="w-5 h-5 text-indigo-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Upload Resume (PDF, DOCX, TXT)
                    </span>
                    <input
                      type="file"
                      accept={ACCEPTED_FILE_EXTENSIONS}
                      onChange={(e) => handleFileUpload(e, 'resume')}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {/* JD */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <Briefcase className="w-5 h-5 text-indigo-400" />
                    <h2 className="text-base font-bold text-white">Job Description</h2>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">PDF · DOCX · TXT</span>
                </div>
                {jdFile ? (
                  <div className="p-3 bg-slate-950 border border-indigo-500/30 rounded-xl flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white truncate">
                        {jdFile.name}
                      </span>
                      <button
                        onClick={clearJd}
                        className="text-slate-400 hover:text-rose-400 text-xs shrink-0 ml-2"
                      >
                        Change
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      {jdFile.isIndexing ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
                          <span className="text-amber-300">Extracting JD...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Indexed & ready for instant answers</span>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <label className="border-2 border-dashed border-slate-800 hover:border-indigo-500/50 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer bg-slate-950/40">
                    <Upload className="w-5 h-5 text-indigo-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Upload JD (PDF, DOCX, TXT)
                    </span>
                    <input
                      type="file"
                      accept={ACCEPTED_FILE_EXTENSIONS}
                      onChange={(e) => handleFileUpload(e, 'jd')}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {/* RAG Prepared Q&A */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <BookOpen className="w-5 h-5 text-indigo-400" />
                    <h2 className="text-base font-bold text-white">Prepared Q&A</h2>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">PDF · DOCX · TXT</span>
                </div>
                <form onSubmit={addPreparedDoc} className="flex flex-col gap-2 mb-3">
                  <input
                    type="text"
                    placeholder="Doc Title (e.g. System Design)"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                  />
                  {newDocFile ? (
                    <div className="flex items-center justify-between p-2 bg-slate-950 rounded-lg text-xs">
                      <span className="text-indigo-300 truncate">{newDocFile.name}</span>
                      <button
                        type="button"
                        onClick={() => setNewDocFile(null)}
                        className="text-rose-400"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <label className="border border-dashed border-slate-800 hover:border-indigo-500 rounded-lg p-2 flex items-center justify-center gap-2 cursor-pointer text-xs text-slate-300">
                      <Upload className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Select PDF, DOCX, or TXT</span>
                      <input
                        type="file"
                        accept={ACCEPTED_FILE_EXTENSIONS}
                        onChange={(e) => handleFileUpload(e, 'rag')}
                        className="hidden"
                      />
                    </label>
                  )}
                  <button
                    type="submit"
                    className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium"
                  >
                    Add Document
                  </button>
                </form>

                <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto">
                  {preparedDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-2 bg-slate-950 rounded-lg flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        {doc.isIndexing ? (
                          <RefreshCw className="w-3 h-3 animate-spin text-amber-400 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        )}
                        <span className="text-indigo-300 truncate">{doc.title}</span>
                      </div>
                      <button
                        onClick={() => removeRagDoc(doc.id)}
                        className="text-slate-500 hover:text-rose-400 shrink-0 ml-2"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-slate-800 flex justify-end">
                <button
                  onClick={() => setActiveTab('copilot')}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md"
                >
                  <span>Start Copilot</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Live Spoken HUD */}
        {activeTab === 'copilot' && (
          <div className="flex flex-col gap-6">
            {/* Active Context Summary Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 px-1">
              <div className="flex items-center gap-2">
                <span>Active Context:</span>
                <span className={resumeFile ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                  Resume ({resumeFile ? resumeFile.name : 'Not uploaded'})
                </span>
                <span>·</span>
                <span className={jdFile ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                  JD ({jdFile ? jdFile.name : 'Not uploaded'})
                </span>
                <span>·</span>
                <span
                  className={
                    preparedDocs.length > 0 ? 'text-emerald-400 font-medium' : 'text-slate-500'
                  }
                >
                  Prepared Q&A ({preparedDocs.length} doc{preparedDocs.length === 1 ? '' : 's'})
                </span>
              </div>
                  <span className="text-indigo-400 font-mono">
                    stream=True · Incoming Stream Only (Laptop Mic Disabled)
                  </span>
            </div>

            {/* Incoming Audio Source & Live Capture Bar */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => !isListening && setCaptureMode('system_audio')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                        captureMode === 'system_audio'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <MonitorSpeaker className="w-3.5 h-3.5" />
                      <span>System / Meeting Audio (Zoom · Teams · Meet)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isListening) {
                          setCaptureMode('loopback_device');
                          refreshAudioDevices();
                        }
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                        captureMode === 'loopback_device'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>Virtual Loopback (Stereo Mix / VB-Cable)</span>
                    </button>
                  </div>

                  {captureMode === 'loopback_device' && (
                    <select
                      value={selectedDeviceId}
                      onChange={(e) => setSelectedDeviceId(e.target.value)}
                      disabled={isListening}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 max-w-xs truncate"
                    >
                      {audioDevices.length === 0 ? (
                        <option value="">Default Loopback Input</option>
                      ) : (
                        audioDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || `Audio Input (${d.deviceId.slice(0, 6)})`}
                          </option>
                        ))
                      )}
                    </select>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleListening}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-lg transition-all whitespace-nowrap ${
                      isListening
                        ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
                    }`}
                  >
                    <MonitorSpeaker className="w-4 h-4" />
                    <span>
                      {isListening
                        ? 'Stop Incoming Audio'
                        : 'Start Capturing Interviewer Audio'}
                    </span>
                  </button>

                  {isListening && (
                    <button
                      type="button"
                      onClick={flushCurrentUtteranceNow}
                      className="px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold whitespace-nowrap"
                      title="Immediately transcribe and answer what the interviewer just said"
                    >
                      Answer Now
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-800/80">
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <Volume2
                    className={`w-4 h-4 ${
                      isSpeakingDetected ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  />
                  <div className="w-28 h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-75"
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-slate-300">
                    {liveTranscriptBuffer
                      ? `Hearing: "${liveTranscriptBuffer}"`
                      : isSpeakingDetected
                      ? 'Interviewer speaking... (capturing full question)'
                      : audioStatusMsg ||
                        (captureMode === 'system_audio'
                          ? 'Click "Start Capturing Interviewer Audio" and check "Share system/tab audio" to capture incoming speaker audio.'
                          : 'Select Stereo Mix or VB-Cable to capture incoming interviewer audio.')}
                  </span>
                </div>

                <form onSubmit={handleManualSubmit} className="flex items-center gap-2 flex-1 max-w-xl">
                  <input
                    type="text"
                    placeholder="Type question or coding task (Auto-detects Direct · Hint · STAR · Code)..."
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold whitespace-nowrap"
                  >
                    Ask Now
                  </button>
                  <button
                    type="button"
                    onClick={handleWritePythonSubmit}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-semibold whitespace-nowrap shadow-lg shadow-cyan-600/20"
                    title="Generate Python 3 code only"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>Write Python</span>
                  </button>
                </form>
              </div>

              {/* Automatic Answer Response Type Selector Bar (Auto, Direct, Hint, STAR, Code) */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Interview Response Type:</span>
                  </span>
                  <span className="text-[11px] text-slate-400 hidden sm:inline">
                    (Agent automatically identifies question type: Direct, Hint, STAR, or Code)
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      {
                        id: 'auto',
                        label: 'Auto (Agent Detects)',
                        icon: Sparkles,
                      },
                      {
                        id: 'direct',
                        label: 'Direct',
                        icon: Target,
                      },
                      {
                        id: 'hint',
                        label: 'Hint',
                        icon: Lightbulb,
                      },
                      {
                        id: 'star',
                        label: 'STAR',
                        icon: Award,
                      },
                      {
                        id: 'code',
                        label: 'Code',
                        icon: Code2,
                      },
                    ] as const
                  ).map((opt) => {
                    const IconComp = opt.icon;
                    const active = answerStyle === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setAnswerStyle(opt.id);
                          saveAppSettings({ answerStyle: opt.id });
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          active
                            ? 'bg-indigo-600 text-white border-indigo-400 shadow-md shadow-indigo-600/20'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        <IconComp className="w-3.5 h-3.5" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Live Streaming Glanceable Answer Cards (hidden when Translucent Overlay HUD is active so 2 HUDs never appear on screen) */}
            {isFloatingMode && !pipContainer && !isVideoPipActive ? (
              <div className="bg-slate-900/40 border border-indigo-500/30 rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-3">
                <h3 className="text-sm font-bold text-white">
                  Translucent Floating HUD Active on Screen
                </h3>
                <p className="text-xs text-slate-400 max-w-md">
                  Only 1 HUD is shown so your screen stays uncluttered. Drag the translucent HUD anywhere, adjust its glass transparency slider, or pop it out into a separate Always-On-Top OS window.
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={openSeparateAlwaysOnTopHud}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Pop Out Separate Always-On-Top Window</span>
                  </button>
                  <button
                    type="button"
                    onClick={closeFloatingHud}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium"
                  >
                    Dock Back to Page
                  </button>
                </div>
              </div>
            ) : (
            <div className="flex flex-col gap-4">
              {transcriptLog.length === 0 ? (
                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-10 text-center flex flex-col items-center justify-center gap-3">
                  <h3 className="text-sm font-bold text-white">
                    Glanceable Interview Assistant Ready (Auto: Direct · Hint · STAR · Code)
                  </h3>
                  <p className="text-xs text-slate-400 max-w-xl leading-relaxed">
                    The agent automatically identifies the response type for each question: <strong className="text-indigo-300">Direct</strong> (full streaming spoken answer with <code className="text-indigo-300">stream=True</code>), <strong className="text-amber-300">Hint</strong> (bullet hints only), <strong className="text-emerald-300">STAR</strong> ([S][T][A][R]), or <strong className="text-cyan-300">Code</strong> (Python 3 code section only).
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-slate-400">
                      Showing {transcriptLog.length} interview question{transcriptLog.length === 1 ? '' : 's'} · Click Direct, Hint, STAR, or Code on any card to switch format instantly
                    </span>
                    <button
                      type="button"
                      onClick={() => setTranscriptLog([])}
                      className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear All</span>
                    </button>
                  </div>
                  {transcriptLog.map((item) => {
                    const rType: ResolvedAnswerType = item.responseType || 'direct';
                    const meta = RESPONSE_TYPE_META[rType];
                    return (
                      <div
                        key={item.id}
                        className="bg-slate-900/90 border border-indigo-500/30 rounded-2xl p-5 md:p-6 shadow-2xl flex flex-col gap-4"
                      >
                        <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-3">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span
                              className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-md border ${meta.badgeClass}`}
                              title={meta.desc}
                            >
                              {item.autoDetected
                                ? `AUTO-DETECTED · ${meta.shortLabel}`
                                : meta.shortLabel}
                            </span>
                            <span className="text-xs md:text-sm text-white font-semibold font-mono">
                              Q: &ldquo;{item.question}&rdquo;
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {item.isStreaming && (
                              <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1 mr-1">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Streaming...
                              </span>
                            )}

                            {/* Instant Per-Question Type Switcher (Direct, Hint, STAR, Code) */}
                            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                              {(['direct', 'hint', 'star', 'code'] as const).map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  disabled={item.isStreaming}
                                  onClick={() =>
                                    processSpokenQuestion(item.question, true, t, item.id)
                                  }
                                  className={`px-2 py-1 rounded text-[11px] font-mono uppercase transition-colors ${
                                    rType === t
                                      ? 'bg-indigo-600 text-white font-bold'
                                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                                  }`}
                                  title={`Regenerate this answer as ${RESPONSE_TYPE_META[t].label}`}
                                >
                                  {t}
                                </button>
                              ))}
                            </div>

                            <button
                              onClick={() => copyToClipboard(item.spokenAnswer, item.id)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-lg text-xs font-medium transition-colors border border-indigo-500/30"
                            >
                              {copiedId === item.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                            </button>
                            <button
                              onClick={() => removeQuestionCard(item.id)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
                              title="Dismiss question"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Glanceable At-A-Glance Answer + Python Program */}
                        <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-4 md:p-5">
                          {renderGlanceableAnswer(item, false)}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
            )}
          </div>
        )}

        {/* Tab 3: History & Export */}
        {activeTab === 'history' && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">
                Session Transcript & Spoken Script History
              </h2>
              <button
                onClick={exportSessionReport}
                disabled={transcriptLog.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold"
              >
                <Download className="w-4 h-4" />
                <span>Export Script (.md)</span>
              </button>
            </div>

            {transcriptLog.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                No questions recorded yet.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {transcriptLog.map((item, idx) => {
                  const rType: ResolvedAnswerType = item.responseType || 'direct';
                  const meta = RESPONSE_TYPE_META[rType];
                  return (
                    <div
                      key={item.id}
                      className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-col gap-3"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${meta.badgeClass}`}
                        >
                          {item.autoDetected ? `AUTO · ${meta.shortLabel}` : meta.shortLabel}
                        </span>
                        <span className="text-xs text-indigo-400 font-bold">
                          Q{transcriptLog.length - idx}: &ldquo;{item.question}&rdquo;
                        </span>
                      </div>
                      {renderGlanceableAnswer(item, false)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Settings & Suggested Models */}
        {activeTab === 'settings' && (
          <div className="flex flex-col gap-6">
            {/* Suggested Answer Generation Models */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Cpu className="w-5 h-5 text-indigo-400" />
                  <div>
                    <h2 className="text-base font-bold text-white">
                      Suggested Answer Generation Models
                    </h2>
                    <p className="text-xs text-slate-400">
                      Select the primary Gemini model used to stream first-person interview answers from your Resume, JD, and Prepared Q&amp;A.
                    </p>
                  </div>
                </div>
                {settingsSavedMsg && (
                  <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {settingsSavedMsg}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SUGGESTED_ANSWER_MODELS.map((model) => {
                  const isSelected = answerModel === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        setAnswerModel(model.id);
                        saveAppSettings({ answerModel: model.id });
                      }}
                      className={`text-left p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                        isSelected
                          ? 'bg-indigo-950/40 border-indigo-500 shadow-lg shadow-indigo-500/10'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-white">{model.name}</span>
                          <span
                            className={`text-[11px] font-mono px-2 py-0.5 rounded-md border ${
                              model.recommended
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                                : 'bg-slate-900 text-indigo-300 border-slate-700'
                            }`}
                          >
                            {model.badge}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">{model.id}</span>
                        <p className="text-xs text-slate-300 leading-relaxed mt-1">
                          {model.description}
                        </p>
                      </div>
                      <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                        <strong className="text-slate-200">Best for:</strong> {model.bestFor}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Suggested Audio Transcription Models */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-4">
              <div className="flex items-center gap-2.5">
                <MonitorSpeaker className="w-5 h-5 text-indigo-400" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    Suggested Incoming Audio Transcription Models
                  </h2>
                  <p className="text-xs text-slate-400">
                    Select the model used to transcribe incoming interviewer voice questions from Zoom, Teams, or Google Meet.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {SUGGESTED_AUDIO_MODELS.map((model) => {
                  const isSelected = audioModel === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        setAudioModel(model.id);
                        saveAppSettings({ audioModel: model.id });
                      }}
                      className={`text-left p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                        isSelected
                          ? 'bg-indigo-950/40 border-indigo-500 shadow-lg shadow-indigo-500/10'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-white">{model.name}</span>
                        </div>
                        <span
                          className={`text-[11px] font-mono w-fit px-2 py-0.5 rounded-md border ${
                            model.recommended
                              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                              : 'bg-slate-900 text-indigo-300 border-slate-700'
                          }`}
                        >
                          {model.badge}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">{model.id}</span>
                        <p className="text-xs text-slate-300 leading-relaxed mt-1">
                          {model.description}
                        </p>
                      </div>
                      <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                        <strong className="text-slate-200">Best for:</strong> {model.bestFor}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Streaming & Response Behavior Configuration */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-5">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-5 h-5 text-indigo-400" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    Application &amp; Streaming Configurations
                  </h2>
                  <p className="text-xs text-slate-400">
                    Fine-tune response pacing, reasoning latency, temperature, and automatic model rotation.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Interview Answer Response Type */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
                  <label className="text-xs font-semibold text-white">
                    Interview Answer Response Type
                  </label>
                  <select
                    value={answerStyle}
                    onChange={(e) => {
                      const val = e.target.value as AnswerResponseType;
                      setAnswerStyle(val);
                      saveAppSettings({ answerStyle: val });
                    }}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200"
                  >
                    <option value="auto">Auto (Agent Identifies: Direct · Hint · STAR · Code)</option>
                    <option value="direct">Direct (Read-Aloud Spoken Answer — No Sentence Limit, stream=True)</option>
                    <option value="hint">Hint (Just Bullet-Point Hints)</option>
                    <option value="star">STAR (Situation · Task · Action · Result)</option>
                    <option value="code">Code (Python 3 Code Only)</option>
                  </select>
                  <span className="text-[11px] text-slate-400">
                    Auto mode automatically identifies the response type for each question (Direct, Hint, STAR, Code).
                  </span>
                </div>

                {/* Reasoning / Latency Mode */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
                  <label className="text-xs font-semibold text-white">
                    Reasoning &amp; Streaming Latency
                  </label>
                  <select
                    value={thinkingLevel}
                    onChange={(e) => {
                      const val = e.target.value as 'MINIMAL' | 'LOW' | 'MEDIUM';
                      setThinkingLevel(val);
                      saveAppSettings({ thinkingLevel: val });
                    }}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200"
                  >
                    <option value="MINIMAL">Minimal Thinking (Instant First Token)</option>
                    <option value="LOW">Low Thinking (Fast + Extra Accuracy)</option>
                    <option value="MEDIUM">Medium Thinking (Deep System Design)</option>
                  </select>
                  <span className="text-[11px] text-slate-400">
                    Minimal starts streaming answers immediately after the interviewer finishes speaking.
                  </span>
                </div>

                {/* Temperature */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-white">
                      Response Temperature
                    </label>
                    <span className="text-xs font-mono text-indigo-400">{temperature.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setTemperature(val);
                      saveAppSettings({ temperature: val });
                    }}
                    className="w-full accent-indigo-500 mt-1"
                  />
                  <span className="text-[11px] text-slate-400">
                    Recommended: 0.3 for grounded, factual answers strictly faithful to your Resume &amp; RAG docs.
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-800">
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoFallback}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setAutoFallback(checked);
                      saveAppSettings({ autoFallback: checked });
                    }}
                    className="rounded accent-indigo-500"
                  />
                  <span>
                    <strong>Automatic Multi-Model Quota Rotation:</strong> Automatically rotate across backup Gemini models and local RAG synthesis if the primary model hits a rate limit.
                  </span>
                </label>

                <span className="text-[11px] text-slate-400 font-mono">
                  Environment variables &amp; secrets are managed in the Settings &gt; Secrets panel.
                </span>
              </div>
            </div>
          </div>
        )}
      </main>
      </div>
    </div>
  );
}
