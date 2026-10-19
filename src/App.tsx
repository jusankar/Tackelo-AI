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
} from 'lucide-react';

interface QnAItem {
  id: string;
  timestamp: string;
  question: string;
  spokenAnswer: string;
  isStreaming?: boolean;
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
  const [activeTab, setActiveTab] = useState<'setup' | 'copilot' | 'history' | 'settings'>('setup');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // Application & Model Configuration Settings
  const [answerModel, setAnswerModel] = useState<string>('gemini-3.1-flash-lite');
  const [audioModel, setAudioModel] = useState<string>('gemini-3.5-transcribe');
  const [temperature, setTemperature] = useState<number>(0.3);
  const [thinkingLevel, setThinkingLevel] = useState<'MINIMAL' | 'LOW' | 'MEDIUM'>('MINIMAL');
  const [answerStyle, setAnswerStyle] = useState<'concise' | 'balanced' | 'star'>('balanced');
  const [autoFallback, setAutoFallback] = useState<boolean>(true);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string>('');

  // Document Upload States (PDF, DOCX, TXT)
  const [resumeFile, setResumeFile] = useState<UploadedDocFile | null>(null);
  const [jdFile, setJdFile] = useState<UploadedDocFile | null>(null);
  const [preparedDocs, setPreparedDocs] = useState<PreparedDoc[]>([]);

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

  const pipWindowRef = useRef<Window | null>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudVideoRef = useRef<HTMLVideoElement | null>(null);
  const dragOffsetRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Refs to ensure audio callbacks always read latest uploaded documents & settings without stale closures
  const contextRef = useRef<{
    resumeFile: UploadedDocFile | null;
    jdFile: UploadedDocFile | null;
    preparedDocs: PreparedDoc[];
    answerModel: string;
    audioModel: string;
    temperature: number;
    thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM';
    answerStyle: 'concise' | 'balanced' | 'star';
    autoFallback: boolean;
  }>({
    resumeFile: null,
    jdFile: null,
    preparedDocs: [],
    answerModel: 'gemini-3.1-flash-lite',
    audioModel: 'gemini-3.5-transcribe',
    temperature: 0.3,
    thinkingLevel: 'MINIMAL',
    answerStyle: 'balanced',
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
        if (parsed.answerStyle) setAnswerStyle(parsed.answerStyle);
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
          if (data.settings.answerStyle) setAnswerStyle(data.settings.answerStyle);
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
    answerStyle: 'concise' | 'balanced' | 'star';
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
      /\b(what|why|how|when|where|who|which|whose|whom|tell|describe|explain|walk|share|give|discuss|elaborate|compare|contrast|difference|can you|could you|would you|will you|have you|did you|do you|are you|is there|are there|talk about|experience with|familiar with|worked with|handle|approach|design|implement|build|solve|debug|optimize)\b/i;

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

  const processSpokenQuestion = async (text: string, isManual: boolean = false) => {
    const cleanQuestion = text.trim();
    if (!cleanQuestion) return;

    // For automatic voice triggers, strictly allow only genuine spoken questions and reject any echo of answers being read aloud
    if (!isManual) {
      if (!isGenuineVoiceQuestion(cleanQuestion)) return;
      if (isEchoOfGeneratedAnswer(cleanQuestion)) return;
    }

    // Deduplicate if the exact same or overlapping question was triggered within the last 8 seconds
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

    const itemId = Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const initialItem: QnAItem = {
      id: itemId,
      timestamp,
      question: cleanQuestion,
      spokenAnswer: '',
      isStreaming: true,
    };

    setTranscriptLog((prev) => [initialItem, ...prev]);
    setIsProcessing(true);

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

  const removeQuestionCard = (id: string) => {
    setTranscriptLog((prev) => prev.filter((item) => item.id !== id));
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportSessionReport = () => {
    const markdown =
      `# Tackelo AI - Interview Spoken Script Report\nGenerated: ${new Date().toLocaleString()}\n\n` +
      transcriptLog
        .map(
          (item, idx) =>
            `## Question ${transcriptLog.length - idx}: ${item.question}\n\n**Spoken Answer:**\n${item.spokenAnswer}\n\n---\n`
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

  // Render live streaming question & spoken answer onto offscreen Canvas for Always-On-Top Video Picture-in-Picture window
  useEffect(() => {
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
    ctx.fillStyle = 'rgba(30, 27, 75, 0.92)';
    ctx.fillRect(0, 0, W, 54);
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 54);
    ctx.lineTo(W, 54);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px system-ui, -apple-system, sans-serif';
    ctx.fillText('Tackelo AI · Live Floating HUD', 20, 34);

    // Audio Status Pill on right of header
    ctx.fillStyle = isListening
      ? isSpeakingDetected
        ? '#34d399'
        : '#818cf8'
      : '#94a3b8';
    ctx.font = '600 15px ui-monospace, monospace';
    const statusLabel = isListening
      ? isSpeakingDetected
        ? '● INTERVIEWER SPEAKING...'
        : '● LISTENING (INCOMING AUDIO)'
      : '○ IDLE';
    ctx.fillText(statusLabel, W - ctx.measureText(statusLabel).width - 20, 34);

    const latest = transcriptLog[0];
    if (!latest) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 22px system-ui, -apple-system, sans-serif';
      ctx.fillText('Ready for incoming interviewer questions...', 28, 130);
      ctx.font = '400 17px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText(
        'Keep this Always-On-Top window open over Zoom, Teams, Meet, or your IDE.',
        28,
        168
      );
      ctx.fillText(
        'Spoken answers will stream here word-by-word in real time.',
        28,
        198
      );
      return;
    }

    // Draw Question Box
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(18, 68, W - 36, 68);
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
    ctx.strokeRect(18, 68, W - 36, 68);

    ctx.fillStyle = '#a5b4fc';
    ctx.font = 'bold 17px ui-monospace, monospace';
    const qPrefix = `Q: "${latest.question}"`;
    const maxQWidth = W - 64;
    let qLine = qPrefix;
    if (ctx.measureText(qLine).width > maxQWidth) {
      while (qLine.length > 10 && ctx.measureText(qLine + '..."').width > maxQWidth) {
        qLine = qLine.slice(0, -1);
      }
      qLine += '..."';
    }
    ctx.fillText(qLine, 32, 108);

    // Draw Spoken Answer Body with word wrapping and auto-scroll for long streaming answers
    const fontPx = hudFontSize === 'lg' ? 25 : hudFontSize === 'sm' ? 18 : 22;
    const lineHeight = Math.round(fontPx * 1.48);
    ctx.font = `500 ${fontPx}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = '#f8fafc';

    const answerText = latest.spokenAnswer || (latest.isStreaming ? 'Generating answer...' : '');
    const paragraphs = answerText.split(/\n+/);
    const wrappedLines: string[] = [];
    const maxLineWidth = W - 56;

    for (const para of paragraphs) {
      const words = para.split(/\s+/);
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxLineWidth && currentLine) {
          wrappedLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) wrappedLines.push(currentLine);
    }

    const availableHeight = H - 165;
    const maxVisibleLines = Math.max(1, Math.floor(availableHeight / lineHeight));
    const visibleLines =
      wrappedLines.length > maxVisibleLines
        ? wrappedLines.slice(wrappedLines.length - maxVisibleLines)
        : wrappedLines;

    let y = 175;
    for (const line of visibleLines) {
      ctx.fillText(line, 28, y);
      y += lineHeight;
    }
  }, [transcriptLog, isListening, isSpeakingDetected, opacity, hudFontSize]);

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
  // Uses Document Picture-in-Picture (interactive portal) or falls back to Canvas-to-Video Picture-in-Picture
  const openSeparateAlwaysOnTopHud = async () => {
    setIsFloatingMode(true);

    // 1. Try Document Picture-in-Picture API (opens a separate always-on-top interactive window)
    const docPip = (window as any).documentPictureInPicture;
    if (docPip && typeof docPip.requestWindow === 'function') {
      try {
        if (pipWindowRef.current && !pipWindowRef.current.closed) {
          pipWindowRef.current.focus();
          return;
        }
        const pipWin: Window = await docPip.requestWindow({
          width: 480,
          height: 580,
        });
        pipWindowRef.current = pipWin;
        pipWin.document.title = 'Tackelo AI — Floating HUD';

        // Copy all stylesheets into the separate always-on-top window
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

        pipWin.addEventListener('pagehide', () => {
          setPipContainer(null);
          pipWindowRef.current = null;
        });
        return;
      } catch {
        // If blocked by iframe permissions policy, proceed to Video Picture-in-Picture fallback
      }
    }

    // 2. Fallback: Always-On-Top Video Picture-in-Picture teleprompter (works even inside iframes)
    try {
      const canvas = hudCanvasRef.current;
      const video = hudVideoRef.current;
      if (canvas && video) {
        if (document.pictureInPictureElement) {
          return;
        }
        if (!video.srcObject) {
          const stream = (canvas as any).captureStream
            ? (canvas as any).captureStream(20)
            : null;
          if (stream) {
            video.srcObject = stream;
          }
        }
        await video.play();
        if (typeof (video as any).requestPictureInPicture === 'function') {
          video.onleavepictureinpicture = () => setIsVideoPipActive(false);
          await (video as any).requestPictureInPicture();
          setIsVideoPipActive(true);
        }
      }
    } catch {
      // Draggable translucent overlay remains active
    }
  };

  const closeFloatingHud = async () => {
    setIsFloatingMode(false);
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
      setIsVideoPipActive(false);
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

            {/* Quick Manual Question Input */}
            <form
              onSubmit={handleManualSubmit}
              className="flex items-center gap-1.5 px-3.5 py-2 border-b border-slate-800/80"
            >
              <input
                type="text"
                placeholder="Type question or listen to incoming audio..."
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                className="flex-1 bg-slate-900/80 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shrink-0"
              >
                Ask
              </button>
            </form>

            {/* Live Streaming Spoken Answer Teleprompter */}
            <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3 max-h-[380px]">
              {transcriptLog.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-300 flex flex-col items-center gap-2">
                  <p className="font-semibold text-white">
                    Floating Teleprompter Active
                  </p>
                  <p className="text-[11px] text-slate-400 max-w-xs">
                    Interact freely with Zoom, Teams, Meet, or your coding window. Spoken answers stream here automatically.
                  </p>
                </div>
              ) : (
                transcriptLog.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl p-3.5 border border-indigo-500/30 flex flex-col gap-2"
                    style={{ backgroundColor: `rgba(15, 23, 42, ${Math.min(0.92, opacity + 0.1)})` }}
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-1.5">
                      <span className="text-xs font-mono text-indigo-300 truncate">
                        Q: &ldquo;{item.question}&rdquo;
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
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
                    <p className={`${textSizeClass} text-white font-medium whitespace-pre-line`}>
                      {item.spokenAnswer || (item.isStreaming ? '...' : '')}
                    </p>
                  </div>
                ))
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

      {/* Hidden high-DPI canvas + video stream for Always-On-Top OS Picture-in-Picture HUD window */}
      <canvas ref={hudCanvasRef} width={760} height={480} className="hidden" />
      <video ref={hudVideoRef} className="hidden" muted playsInline />

      {/* Portal into Separate Always-On-Top Document Picture-in-Picture Window */}
      {pipContainer && createPortal(renderHudContent(true), pipContainer)}

      {/* Non-blocking Click-Through Draggable Translucent HUD Overlay (user can freely click everything around it) */}
      {isFloatingMode && !pipContainer && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <div
            style={{ left: `${hudPosition.x}px`, top: `${hudPosition.y}px` }}
            className="fixed w-[430px] max-w-[94vw] rounded-2xl border border-indigo-500/50 shadow-2xl overflow-hidden pointer-events-auto"
          >
            {renderHudContent(false)}
          </div>
        </div>
      )}

      {/* Top Bar Contract */}
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
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 flex flex-col gap-6">

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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

                <form onSubmit={handleManualSubmit} className="flex items-center gap-2 flex-1 max-w-md">
                  <input
                    type="text"
                    placeholder="Or type/paste question for instant streaming answer..."
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
                </form>
              </div>
            </div>

            {/* Live Streaming Spoken Answer Cards */}
            <div className="flex flex-col gap-4">
              {transcriptLog.length === 0 ? (
                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-2">
                  <h3 className="text-sm font-bold text-white">
                    Ready for incoming interviewer questions
                  </h3>
                  <p className="text-xs text-slate-400 max-w-lg">
                    Capture incoming system/meeting audio or type a question above. Your personalized answer streams word-by-word immediately.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-slate-400">
                      Showing {transcriptLog.length} verified voice question{transcriptLog.length === 1 ? '' : 's'}
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
                  {transcriptLog.map((item) => (
                    <div
                      key={item.id}
                      className="bg-slate-900/90 border border-indigo-500/30 rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
                    >
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2 gap-3">
                        <span className="text-xs text-slate-300 font-mono">
                          Q: &ldquo;{item.question}&rdquo;
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {item.isStreaming && (
                            <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              Streaming...
                            </span>
                          )}
                          <button
                            onClick={() => copyToClipboard(item.spokenAnswer, item.id)}
                            className="flex items-center gap-1 px-3 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-lg text-xs font-medium transition-colors border border-indigo-500/30"
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

                      {/* Exact Spoken Answer */}
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
                        <p className="text-base text-slate-100 leading-relaxed font-sans font-medium whitespace-pre-line">
                          {item.spokenAnswer || (item.isStreaming ? '...' : '')}
                        </p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
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
                {transcriptLog.map((item, idx) => (
                  <div
                    key={item.id}
                    className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-col gap-2"
                  >
                    <span className="text-xs text-indigo-400 font-bold">
                      Q{transcriptLog.length - idx}: &ldquo;{item.question}&rdquo;
                    </span>
                    <p className="text-sm text-slate-200 whitespace-pre-line">{item.spokenAnswer}</p>
                  </div>
                ))}
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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Spoken Answer Format */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
                  <label className="text-xs font-semibold text-white">
                    Spoken Answer Style
                  </label>
                  <select
                    value={answerStyle}
                    onChange={(e) => {
                      const val = e.target.value as 'concise' | 'balanced' | 'star';
                      setAnswerStyle(val);
                      saveAppSettings({ answerStyle: val });
                    }}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200"
                  >
                    <option value="concise">Concise (30–45s Quick Spoken Script)</option>
                    <option value="balanced">Balanced (60s Natural Interview Script)</option>
                    <option value="star">STAR Method (Situation · Task · Action · Result)</option>
                  </select>
                  <span className="text-[11px] text-slate-400">
                    Controls how long and structured your first-person spoken answers are.
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
  );
}
