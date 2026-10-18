import React, { useState, useEffect, useRef } from 'react';
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
  const [activeTab, setActiveTab] = useState<'setup' | 'copilot' | 'history'>('setup');

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

  // Floating HUD Overlay State
  const [isFloatingMode, setIsFloatingMode] = useState(false);
  const [opacity, setOpacity] = useState(0.95);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Refs to ensure audio callbacks always read latest uploaded documents without stale closures
  const contextRef = useRef<{
    resumeFile: UploadedDocFile | null;
    jdFile: UploadedDocFile | null;
    preparedDocs: PreparedDoc[];
  }>({
    resumeFile: null,
    jdFile: null,
    preparedDocs: [],
  });

  useEffect(() => {
    contextRef.current = { resumeFile, jdFile, preparedDocs };
  }, [resumeFile, jdFile, preparedDocs]);

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

    const { resumeFile: curResume, jdFile: curJd, preparedDocs: curRag } = contextRef.current;

    try {
      const response = await fetch('/api/interview/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: cleanQuestion,
          stream: true,
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

  return (
    <div
      className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans ${
        isFloatingMode
          ? 'fixed inset-0 z-50 overflow-auto bg-slate-950/95 backdrop-blur-xl'
          : ''
      }`}
      style={{ opacity: isFloatingMode ? opacity : 1 }}
    >
      {/* Hidden active video sink required by Chromium so getDisplayMedia system/tab audio tracks are never suspended */}
      <video ref={hiddenVideoSinkRef} className="hidden" muted playsInline autoPlay />

      {/* Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
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
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setIsFloatingMode(!isFloatingMode)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors whitespace-nowrap"
          >
            {isFloatingMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{isFloatingMode ? 'Exit Floating HUD' : 'Floating HUD'}</span>
          </button>

          {!isListening ? (
            <button
              onClick={toggleListening}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-lg shadow-indigo-600/30 transition-all whitespace-nowrap"
            >
              <MonitorSpeaker className="w-4 h-4" />
              <span>Capture Incoming Audio</span>
            </button>
          ) : (
            <button
              onClick={toggleListening}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg shadow-lg shadow-rose-600/30 transition-all whitespace-nowrap"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>Stop Audio Capture</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 flex flex-col gap-6">
        {isFloatingMode && (
          <div className="bg-slate-900/90 border border-indigo-500/30 rounded-xl p-3 flex items-center justify-between shadow-2xl backdrop-blur-md">
            <span className="text-xs font-semibold text-indigo-300">
              Transparent Floating HUD Active
            </span>
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-2 text-slate-400">
                Opacity:
                <input
                  type="range"
                  min="0.7"
                  max="1.0"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  className="w-24 accent-indigo-500"
                />
              </label>
              <button
                onClick={() => setIsFloatingMode(false)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md border border-slate-700"
              >
                Dock
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
      </main>
    </div>
  );
}
