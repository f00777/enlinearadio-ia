"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Mic,
  Square,
  ArrowRight,
  Download,
  CheckCircle2,
  Send,
  RotateCcw,
  Radio,
  FileAudio,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Clock,
  FileText,
  Upload,
} from "lucide-react";

type WizardStep = 1 | 2 | 3 | 4;

interface TranscriptSegment {
  start: number;
  text: string;
}

interface SponsorMention {
  marca: string;
  timestamp: string;
  tipo: "Mención en vivo" | "Frase comercial" | string;
  cita: string;
}

interface WhatsAppResult {
  success: boolean;
  recipient: string;
  messageId: string | null;
  messagePreview: string;
}

const MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function RadioMonitorWizard() {
  const [step, setStep] = useState<WizardStep>(1);

  // Step 1: Recording & Audio state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioSourceLabel, setAudioSourceLabel] = useState<string>("");
  const [pautaMessage, setPautaMessage] = useState<string>("");
  const [recorderError, setRecorderError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Step 2: Transcription state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [formattedText, setFormattedText] = useState<string>("");
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  // Step 3: Sponsor Detection & Certification state
  const [isDetecting, setIsDetecting] = useState(false);
  const [auspiciadores, setAuspiciadores] = useState<SponsorMention[]>([]);
  const [detectError, setDetectError] = useState<string | null>(null);

  // Step 4: WhatsApp Dispatch state
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [whatsAppResult, setWhatsAppResult] = useState<WhatsAppResult | null>(
    null
  );
  const [whatsAppError, setWhatsAppError] = useState<string | null>(null);
  const [isSendingTemplate, setIsSendingTemplate] = useState(false);
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Revoke previous object URL when replaced
  const updateAudioBlob = (blob: Blob | null, label: string) => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    if (blob) {
      const url = URL.createObjectURL(blob);
      setAudioBlob(blob);
      setAudioUrl(url);
      setAudioSourceLabel(label);
    } else {
      setAudioBlob(null);
      setAudioUrl(null);
      setAudioSourceLabel("");
    }
  };

  // Step 1 handlers
  const handleStartRecording = async () => {
    setRecorderError(null);
    updateAudioBlob(null, "");
    setRecordingSeconds(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const preferredMime = "audio/webm;codecs=opus";
      const fallbackMime = "audio/webm";
      const mimeType = MediaRecorder.isTypeSupported(preferredMime)
        ? preferredMime
        : MediaRecorder.isTypeSupported(fallbackMime)
          ? fallbackMime
          : "";

      const options: MediaRecorderOptions = {
        audioBitsPerSecond: 18000,
      };
      if (mimeType) {
        options.mimeType = mimeType;
      }

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, {
          type: mimeType || "audio/webm",
        });
        if (finalBlob.size > MAX_BYTES) {
          setRecorderError(
            `La grabación supera el límite de 4.5 MB (${formatBytes(
              finalBlob.size
            )}).`
          );
        } else {
          updateAudioBlob(finalBlob, "Grabación en vivo (18 kbps · Opus Mono)");
        }

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };

      recorder.start(1000);
      setIsRecording(true);

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "No fue posible acceder al micrófono.";
      setRecorderError(
        `Permiso de micrófono denegado o dispositivo no disponible (${msg}). Puedes subir un archivo de audio debajo.`
      );
    }
  };

  const handleStopRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRecorderError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setRecorderError(
        `El archivo seleccionado (${formatBytes(
          file.size
        )}) supera el límite de 4.5 MB de Vercel.`
      );
      e.target.value = "";
      return;
    }

    setRecordingSeconds(0);
    updateAudioBlob(file, `Archivo cargado: ${file.name}`);
  };

  const handleLoadDemoSample = async () => {
    setRecorderError(null);
    try {
      const res = await fetch("/demo-pauta.webm");
      if (!res.ok) throw new Error("No se pudo cargar el audio de demostración.");
      const blob = await res.blob();
      const file = new File([blob], "demo-pauta.webm", {
        type: "audio/webm",
      });
      setRecordingSeconds(25);
      updateAudioBlob(file, "Muestra radial de prueba (25s · 18 kbps Opus)");
    } catch (err) {
      setRecorderError(
        err instanceof Error ? err.message : "Error al cargar muestra."
      );
    }
  };

  // Step 1 -> Step 2: Transcribe
  const handleProceedToTranscription = async () => {
    if (!audioBlob) return;
    setStep(2);
    setIsTranscribing(true);
    setTranscribeError(null);

    try {
      const formData = new FormData();
      const fileName =
        audioBlob instanceof File && audioBlob.name
          ? audioBlob.name
          : "transmision-radial.webm";
      formData.append("file", audioBlob, fileName);
      if (pautaMessage.trim()) {
        formData.append("pautaMessage", pautaMessage.trim());
      }

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || `Error al transcribir (${response.status})`
        );
      }

      setSegments(Array.isArray(data.segments) ? data.segments : []);
      setFormattedText(
        typeof data.formattedText === "string" ? data.formattedText : ""
      );
    } catch (err) {
      setTranscribeError(
        err instanceof Error
          ? err.message
          : "Ocurrió un error durante la transcripción."
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleDownloadTxt = () => {
    if (!formattedText) return;
    const blob = new Blob([formattedText], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.href = url;
    link.download = `transcripcion-radial-${stamp}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;
    const contentWidth = pageWidth - margin * 2;
    let y = 20;

    const nowStr = new Intl.DateTimeFormat("es-CL", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Santiago",
    }).format(new Date());

    // Header
    doc.setFont("courier", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 98, 92);
    doc.text("UNIDAD DE CONTROL DE PAUTA · MÓDULO 03", margin, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(22, 22, 21);
    doc.text("EnLínea Radio — Certificación Publicitaria", margin, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(74, 73, 68);
    doc.text("Dashboard de Menciones Publicitarias y Certificación", margin, y);
    y += 5;

    doc.setFont("courier", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 98, 92);
    doc.text(`Fecha de emisión: ${nowStr}`, margin, y);
    y += 5;

    doc.setDrawColor(216, 214, 206);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    // KPI Summary Box
    const boxHeight = 22;
    doc.setFillColor(250, 249, 246);
    doc.setDrawColor(216, 214, 206);
    doc.rect(margin, y, contentWidth, boxHeight, "FD");

    const colWidth = contentWidth / 3;

    // Col 1: Total Menciones
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110, 108, 101);
    doc.text("TOTAL MENCIONES DETECTADAS", margin + 4, y + 7);
    doc.setFont("courier", "bold");
    doc.setFontSize(15);
    doc.setTextColor(22, 22, 21);
    doc.text(String(auspiciadores.length), margin + 4, y + 16);

    // Col 2: Marcas Únicas
    doc.line(margin + colWidth, y, margin + colWidth, y + boxHeight);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110, 108, 101);
    doc.text("MARCAS / AUSPICIADORES ÚNICOS", margin + colWidth + 4, y + 7);
    doc.setFont("courier", "bold");
    doc.setFontSize(15);
    doc.setTextColor(22, 22, 21);
    doc.text(String(uniqueBrandsCount), margin + colWidth + 4, y + 16);

    // Col 3: Estado General
    doc.line(margin + colWidth * 2, y, margin + colWidth * 2, y + boxHeight);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110, 108, 101);
    doc.text("ESTADO GENERAL", margin + colWidth * 2 + 4, y + 7);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(21, 115, 71);
    doc.text("Certificado por IA", margin + colWidth * 2 + 4, y + 16);

    y += boxHeight + 10;

    // Section title
    doc.setFont("courier", "bold");
    doc.setFontSize(10);
    doc.setTextColor(22, 22, 21);
    doc.text(
      `ACTA DE MENCIONES CERTIFICADAS (${auspiciadores.length})`,
      margin,
      y
    );
    y += 6;

    if (auspiciadores.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(90, 88, 82);
      doc.text(
        "No se detectaron menciones comerciales en esta transmisión.",
        margin,
        y + 4
      );
    } else {
      auspiciadores.forEach((item, index) => {
        const cleanTs = item.timestamp.replace(/[\[\]]/g, "").trim() || "00:00";
        const quoteLines = doc.splitTextToSize(
          `"${item.cita}"`,
          contentWidth - 10
        );
        const cardHeight = 16 + quoteLines.length * 5;

        if (y + cardHeight > pageHeight - 20) {
          doc.addPage();
          y = 20;
        }

        doc.setDrawColor(216, 214, 206);
        doc.setFillColor(255, 255, 255);
        doc.rect(margin, y, contentWidth, cardHeight, "FD");

        // Top row: [MM:SS] Marca — Tipo | Certificado
        doc.setFont("courier", "bold");
        doc.setFontSize(10);
        doc.setTextColor(22, 22, 21);
        doc.text(`[${cleanTs}]`, margin + 4, y + 7);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(`${index + 1}. ${item.marca}`, margin + 22, y + 7);

        doc.setFont("courier", "normal");
        doc.setFontSize(9);
        doc.setTextColor(90, 88, 82);
        doc.text(`(${item.tipo})`, margin + 22, y + 12);

        doc.setFont("courier", "bold");
        doc.setFontSize(9);
        doc.setTextColor(21, 115, 71);
        doc.text(
          "CERTIFICADO",
          pageWidth - margin - 4,
          y + 7,
          { align: "right" }
        );

        // Quote
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9.5);
        doc.setTextColor(51, 50, 46);
        doc.text(quoteLines, margin + 6, y + 17);

        y += cardHeight + 4;
      });
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    doc.save(`certificado-pauta-${stamp}.pdf`);
  };

  // Step 2 -> Step 3: Detect Sponsors
  const handleProceedToSponsorDetection = async () => {
    setStep(3);
    setIsDetecting(true);
    setDetectError(null);

    try {
      const response = await fetch("/api/detect-sponsors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript: formattedText,
          pautaMessage: pautaMessage.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || `Error al detectar auspiciadores (${response.status})`
        );
      }

      setAuspiciadores(
        Array.isArray(data.auspiciadores) ? data.auspiciadores : []
      );
    } catch (err) {
      setDetectError(
        err instanceof Error
          ? err.message
          : "Ocurrió un error al analizar las menciones publicitarias."
      );
    } finally {
      setIsDetecting(false);
    }
  };

  // Step 3 -> Step 4: Send WhatsApp
  const handleProceedToWhatsApp = async () => {
    setStep(4);
    setIsSendingWhatsApp(true);
    setWhatsAppError(null);
    setWhatsAppResult(null);

    try {
      const response = await fetch("/api/send-whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ auspiciadores }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || `Error al enviar reporte por WhatsApp (${response.status})`
        );
      }

      setWhatsAppResult({
        success: true,
        recipient: data.recipient,
        messageId: data.messageId,
        messagePreview: data.messagePreview,
      });
    } catch (err) {
      setWhatsAppError(
        err instanceof Error
          ? err.message
          : "No fue posible enviar el reporte por WhatsApp."
      );
    } finally {
      setIsSendingWhatsApp(false);
    }
  };

  const handleSendHelloTemplate = async () => {
    setIsSendingTemplate(true);
    setTemplateStatus(null);
    try {
      const response = await fetch("/api/send-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "template_hello" }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Error al enviar plantilla hello_world");
      }
      setTemplateStatus(
        `Plantilla 'hello_world' enviada a +${data.recipient}. Responde cualquier mensaje (ej. "Hola") en tu WhatsApp al número +1 555-163-0956 y luego presiona "Reenviar Reporte de Texto".`
      );
    } catch (err) {
      setTemplateStatus(
        err instanceof Error ? err.message : "Error al enviar plantilla."
      );
    } finally {
      setIsSendingTemplate(false);
    }
  };

  // Full Reset -> Step 1
  const handleReset = () => {
    if (isRecording) {
      handleStopRecording();
    }
    updateAudioBlob(null, "");
    setRecordingSeconds(0);
    setPautaMessage("");
    setRecorderError(null);

    setSegments([]);
    setFormattedText("");
    setTranscribeError(null);

    setAuspiciadores([]);
    setDetectError(null);

    setWhatsAppResult(null);
    setWhatsAppError(null);
    setTemplateStatus(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setStep(1);
  };

  const uniqueBrandsCount = new Set(
    auspiciadores.map((item) => item.marca.trim().toLowerCase()).filter(Boolean)
  ).size;

  const stepsMeta = [
    { num: 1, title: "Grabación", subtitle: "Captura 18 kbps" },
    { num: 2, title: "Transcripción", subtitle: "Marcas de tiempo" },
    { num: 3, title: "Certificación", subtitle: "Auditoría de pauta" },
    { num: 4, title: "Despacho", subtitle: "Reporte WhatsApp" },
  ] as const;

  return (
    <div className="min-h-screen flex flex-col justify-between">
      {/* Top Broadcast Console Header */}
      <header className="border-b border-[#DFDDD4] bg-[#EFECE6]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-[#161615] bg-[#161615] text-[#F6F5F1] flex items-center justify-center">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-[#63625C]">
                  Unidad de Control de Pauta
                </span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#157347]" />
              </div>
              <h1 className="text-base font-semibold tracking-tight text-[#161615]">
                EnLínea Radio — Certificación Publicitaria
              </h1>
            </div>
          </div>

          <div className="font-mono text-xs text-[#575650] flex items-center gap-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-[#DFDDD4]">
            <span>OPUS · 16KHZ · MONO</span>
            <span className="text-[#161615] font-medium">
              PASO {step} DE 4
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* Stepper Bar */}
        <nav
          aria-label="Progreso de certificación"
          className="grid grid-cols-2 sm:grid-cols-4 border border-[#D8D6CE] bg-white mb-8"
        >
          {stepsMeta.map((item, idx) => {
            const isActive = step === item.num;
            const isDone = step > item.num;
            return (
              <div
                key={item.num}
                className={`px-4 py-3 flex items-center gap-3 ${
                  idx < 3 ? "border-b sm:border-b-0 sm:border-r border-[#E6E4DC]" : ""
                } ${
                  isActive
                    ? "bg-[#161615] text-[#F6F5F1]"
                    : isDone
                      ? "bg-[#F9F8F5] text-[#161615]"
                      : "bg-white text-[#8C8A82]"
                }`}
              >
                <span
                  className={`font-mono text-xs w-6 h-6 flex items-center justify-center border ${
                    isActive
                      ? "border-[#F6F5F1] text-[#F6F5F1] font-semibold"
                      : isDone
                        ? "border-[#157347] bg-[#157347] text-white"
                        : "border-[#D8D6CE] text-[#8C8A82]"
                  }`}
                >
                  {isDone ? "✓" : `0${item.num}`}
                </span>
                <div className="leading-tight">
                  <div className="text-xs font-semibold tracking-tight">
                    {item.title}
                  </div>
                  <div
                    className={`text-[11px] font-mono ${
                      isActive ? "text-[#C9C7BE]" : "text-[#8C8A82]"
                    }`}
                  >
                    {item.subtitle}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        {/* STEP 1: GRABADORA DE AUDIO */}
        {step === 1 && (
          <section className="border border-[#D8D6CE] bg-white">
            <div className="border-b border-[#E6E4DC] px-6 py-4 flex items-center justify-between bg-[#FAF9F6]">
              <div>
                <span className="font-mono text-[11px] uppercase tracking-widest text-[#6E6C65]">
                  Módulo 01 · Captura de Señal
                </span>
                <h2 className="text-lg font-semibold text-[#161615]">
                  Grabadora de Transmisión Radial
                </h2>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    isRecording
                      ? "bg-[#C81E1E] animate-pulse"
                      : audioBlob
                        ? "bg-[#157347]"
                        : "bg-[#9E9C94]"
                  }`}
                />
                <span
                  className={
                    isRecording
                      ? "text-[#C81E1E] font-semibold"
                      : "text-[#4A4944]"
                  }
                >
                  {isRecording
                    ? "Grabando en vivo..."
                    : audioBlob
                      ? "Grabación lista para procesar"
                      : "Listo para grabar"}
                </span>
              </div>
            </div>

            <div className="p-8 sm:p-12 flex flex-col items-center text-center">
              {/* Digital Broadcast Chronometer */}
              <div className="mb-6">
                <div className="font-mono text-5xl sm:text-6xl font-light tracking-tight tabular-nums text-[#161615]">
                  {formatTimer(recordingSeconds)}
                </div>
                <p className="font-mono text-xs text-[#78766F] mt-2 uppercase tracking-wider">
                  Tiempo de registro · Máx. 30:00 (~3.8 MB a 18 kbps)
                </p>
              </div>

              {/* Prominent Microphone Button */}
              <div className="my-4">
                {!isRecording ? (
                  <button
                    type="button"
                    onClick={handleStartRecording}
                    className="group relative w-24 h-24 rounded-full border-2 border-[#161615] bg-[#161615] text-[#F6F5F1] hover:bg-[#2C2C2A] active:scale-95 transition flex items-center justify-center cursor-pointer"
                    aria-label="Iniciar Grabación"
                  >
                    <Mic className="w-9 h-9" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStopRecording}
                    className="group relative w-24 h-24 rounded-full border-2 border-[#C81E1E] bg-[#C81E1E] text-white hover:bg-[#A91818] active:scale-95 transition flex items-center justify-center cursor-pointer"
                    aria-label="Terminar Grabación"
                  >
                    <Square className="w-8 h-8 fill-current" />
                  </button>
                )}
              </div>

              {/* Explicit Action Buttons */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                {!isRecording ? (
                  <button
                    type="button"
                    onClick={handleStartRecording}
                    className="px-5 py-2.5 bg-[#161615] text-[#F6F5F1] text-sm font-medium hover:bg-[#2E2E2B] transition flex items-center gap-2 cursor-pointer"
                  >
                    <Mic className="w-4 h-4" />
                    {audioBlob ? "Grabar Nuevamente" : "Iniciar Grabación"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStopRecording}
                    className="px-5 py-2.5 bg-[#C81E1E] text-white text-sm font-medium hover:bg-[#A91818] transition flex items-center gap-2 cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Terminar Grabación
                  </button>
                )}
              </div>

              {/* Error Alert */}
              {recorderError && (
                <div className="mt-6 w-full max-w-lg border border-[#E5B8B8] bg-[#FDF5F5] px-4 py-3 text-left flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-[#C81E1E] shrink-0 mt-0.5" />
                  <p className="text-xs text-[#8A1C1C] leading-relaxed">
                    {recorderError}
                  </p>
                </div>
              )}

              {/* Audio Verification Player once recorded or uploaded */}
              {audioUrl && audioBlob && !isRecording && (
                <div className="mt-8 w-full max-w-lg border border-[#D8D6CE] bg-[#FAF9F6] p-4 text-left">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs font-medium text-[#161615] flex items-center gap-1.5">
                      <FileAudio className="w-3.5 h-3.5 text-[#157347]" />
                      {audioSourceLabel || "Señal capturada"}
                    </span>
                    <span className="font-mono text-xs text-[#6E6C65]">
                      {formatBytes(audioBlob.size)} / 4.50 MB máx.
                    </span>
                  </div>
                  <audio
                    controls
                    src={audioUrl}
                    className="w-full h-10 mt-1"
                  />
                </div>
              )}

              {/* Pauta / Auspiciadores Context Message Field */}
              <div className="mt-8 w-full max-w-lg text-left">
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="pauta-message"
                    className="font-mono text-xs font-semibold uppercase tracking-wider text-[#161615]"
                  >
                    Mensaje de Pauta / Auspiciadores (Jefe de Locutores)
                  </label>
                  <span className="font-mono text-[11px] text-[#6E6C65]">
                    Opcional · Guía fonética IA
                  </span>
                </div>
                <p className="text-xs text-[#575650] mb-2 leading-relaxed">
                  Copia y pega aquí el mensaje con las marcas o menciones que se
                  deben decir al aire (ej. <em>Yankee Candle</em>,{" "}
                  <em>Banco de Chile</em>). Se enviará junto con el audio para
                  corregir palabras o marcas pronunciadas de forma imprecisa.
                </p>
                <textarea
                  id="pauta-message"
                  rows={4}
                  value={pautaMessage}
                  onChange={(e) => setPautaMessage(e.target.value)}
                  placeholder="Ej: Locutores, para este bloque recordar mencionar a: Banco de Chile, Yankee Candle, Sodimac Homecenter y Supermercados Lider..."
                  className="w-full border border-[#D8D6CE] bg-[#FAF9F6] focus:bg-white focus:border-[#161615] focus:outline-none p-3 font-mono text-xs text-[#161615] placeholder:text-[#9E9C94] leading-relaxed transition"
                />
              </div>

              {/* Discreet File Input & Demo Audio Loader */}
              <div className="mt-10 pt-6 border-t border-[#EAE8E1] w-full max-w-lg flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#6E6C65]">
                <label className="inline-flex items-center gap-2 cursor-pointer hover:text-[#161615] transition">
                  <Upload className="w-3.5 h-3.5" />
                  <span className="underline underline-offset-4">
                    Subir archivo de audio (&lt; 4.5 MB)
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleFileUpload}
                    disabled={isRecording}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleLoadDemoSample}
                  disabled={isRecording}
                  className="font-mono text-[11px] text-[#575650] hover:text-[#161615] underline underline-offset-4 cursor-pointer"
                >
                  Cargar muestra radial de prueba (25s)
                </button>
              </div>
            </div>

            {/* Step 1 Footer */}
            <div className="border-t border-[#E6E4DC] bg-[#FAF9F6] px-6 py-4 flex items-center justify-between">
              <span className="font-mono text-xs text-[#6E6C65]">
                {audioBlob
                  ? `Audio verificado (${formatBytes(audioBlob.size)})`
                  : "Capture o cargue un audio para continuar"}
              </span>
              <button
                type="button"
                disabled={!audioBlob || isRecording}
                onClick={handleProceedToTranscription}
                className="px-6 py-2.5 bg-[#161615] text-[#F6F5F1] text-sm font-medium disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[#2E2E2B] transition flex items-center gap-2 cursor-pointer"
              >
                <span>Siguiente</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}

        {/* STEP 2: TRANSCRIPCIÓN Y DESCARGA .TXT */}
        {step === 2 && (
          <section className="border border-[#D8D6CE] bg-white">
            <div className="border-b border-[#E6E4DC] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-[#FAF9F6]">
              <div>
                <span className="font-mono text-[11px] uppercase tracking-widest text-[#6E6C65]">
                  Módulo 02 · Registro Horario (Groq Whisper Large v3)
                </span>
                <h2 className="text-lg font-semibold text-[#161615]">
                  Transcripción con Marcas de Tiempo
                </h2>
              </div>

              {!isTranscribing && formattedText && (
                <button
                  type="button"
                  onClick={handleDownloadTxt}
                  className="px-4 py-2 border border-[#161615] bg-white text-[#161615] text-xs font-mono uppercase tracking-wider hover:bg-[#161615] hover:text-[#F6F5F1] transition flex items-center gap-2 self-start sm:self-auto cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar Transcripción (.txt)
                </button>
              )}
            </div>

            <div className="p-6 sm:p-8">
              {isTranscribing ? (
                <div className="py-16 flex flex-col items-center justify-center text-center">
                  <Loader2 className="w-7 h-7 animate-spin text-[#161615] mb-3" />
                  <p className="text-sm font-medium text-[#161615]">
                    Procesando audio y generando marcas de tiempo...
                  </p>
                  <p className="font-mono text-xs text-[#78766F] mt-1">
                    Modelo: whisper-large-v3 · Idioma: es-CL
                  </p>
                </div>
              ) : transcribeError ? (
                <div className="border border-[#E5B8B8] bg-[#FDF5F5] p-5">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-[#C81E1E] shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-semibold text-[#8A1C1C]">
                        Error en la transcripción
                      </h3>
                      <p className="text-xs text-[#8A1C1C] mt-1">
                        {transcribeError}
                      </p>
                      <div className="mt-4 flex gap-3">
                        <button
                          type="button"
                          onClick={handleProceedToTranscription}
                          className="px-4 py-2 bg-[#161615] text-white text-xs font-mono uppercase cursor-pointer"
                        >
                          Reintentar
                        </button>
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="px-4 py-2 border border-[#161615] text-[#161615] text-xs font-mono uppercase cursor-pointer"
                        >
                          Volver al Paso 1
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <span className="font-mono text-xs text-[#6E6C65] flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      {segments.length} segmentos registrados
                    </span>
                    <div className="flex items-center gap-3">
                      {pautaMessage.trim() && (
                        <span className="font-mono text-[11px] px-2 py-0.5 border border-[#157347] bg-[#EBF5EE] text-[#157347]">
                          ✓ Pauta de auspiciadores aplicada
                        </span>
                      )}
                      <span className="font-mono text-xs text-[#6E6C65]">
                        Formato: [MM:SS] Texto
                      </span>
                    </div>
                  </div>

                  {/* Scrollable Monospace Transcript Log */}
                  <div className="border border-[#D8D6CE] bg-[#FAF9F6] max-h-96 overflow-y-auto p-4 font-mono text-xs sm:text-sm leading-relaxed text-[#161615] whitespace-pre-wrap">
                    {formattedText || "Sin contenido transcrito."}
                  </div>
                </div>
              )}
            </div>

            {/* Step 2 Footer */}
            <div className="border-t border-[#E6E4DC] bg-[#FAF9F6] px-6 py-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={isTranscribing}
                className="text-xs font-mono text-[#575650] hover:text-[#161615] underline underline-offset-4 disabled:opacity-40 cursor-pointer"
              >
                ← Volver a grabadora
              </button>

              <button
                type="button"
                disabled={isTranscribing || !formattedText}
                onClick={handleProceedToSponsorDetection}
                className="px-6 py-2.5 bg-[#161615] text-[#F6F5F1] text-sm font-medium disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[#2E2E2B] transition flex items-center gap-2 cursor-pointer"
              >
                <span>Siguiente</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}

        {/* STEP 3: DASHBOARD DE MENCIONES PUBLICITARIAS Y CERTIFICACIÓN */}
        {step === 3 && (
          <section className="border border-[#D8D6CE] bg-white">
            <div className="border-b border-[#E6E4DC] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#FAF9F6]">
              <div>
                <span className="font-mono text-[11px] uppercase tracking-widest text-[#6E6C65]">
                  Módulo 03 · Auditoría de Pauta (openai/gpt-oss-120b)
                </span>
                <h2 className="text-lg font-semibold text-[#161615]">
                  Dashboard de Menciones Publicitarias y Certificación
                </h2>
              </div>
              {!isDetecting && !detectError && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    className="px-3.5 py-1.5 border border-[#161615] bg-white text-[#161615] text-xs font-mono uppercase tracking-wider hover:bg-[#161615] hover:text-[#F6F5F1] transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Descargar PDF
                  </button>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-[#157347] bg-[#EBF5EE] text-[#157347] font-mono text-xs font-medium">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Certificado por IA
                  </span>
                </div>
              )}
            </div>

            <div className="p-6 sm:p-8">
              {isDetecting ? (
                <div className="py-16 flex flex-col items-center justify-center text-center">
                  <Loader2 className="w-7 h-7 animate-spin text-[#161615] mb-3" />
                  <p className="text-sm font-medium text-[#161615]">
                    Auditando transcripción y extrayendo citas textuales...
                  </p>
                  <p className="font-mono text-xs text-[#78766F] mt-1">
                    Modelo: openai/gpt-oss-120b · Extracción estructurada JSON
                  </p>
                </div>
              ) : detectError ? (
                <div className="border border-[#E5B8B8] bg-[#FDF5F5] p-5">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-[#C81E1E] shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-semibold text-[#8A1C1C]">
                        Error en la detección de auspiciadores
                      </h3>
                      <p className="text-xs text-[#8A1C1C] mt-1">
                        {detectError}
                      </p>
                      <button
                        type="button"
                        onClick={handleProceedToSponsorDetection}
                        className="mt-4 px-4 py-2 bg-[#161615] text-white text-xs font-mono uppercase cursor-pointer"
                      >
                        Reintentar análisis
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* KPI Summary Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 border border-[#D8D6CE] bg-[#FAF9F6]">
                    <div className="p-4 sm:border-r border-b sm:border-b-0 border-[#E6E4DC]">
                      <div className="font-mono text-[11px] uppercase tracking-wider text-[#6E6C65]">
                        Total Menciones Detectadas
                      </div>
                      <div className="font-mono text-3xl font-semibold text-[#161615] mt-1 tabular-nums">
                        {auspiciadores.length}
                      </div>
                    </div>

                    <div className="p-4 sm:border-r border-b sm:border-b-0 border-[#E6E4DC]">
                      <div className="font-mono text-[11px] uppercase tracking-wider text-[#6E6C65]">
                        Marcas / Auspiciadores Únicos
                      </div>
                      <div className="font-mono text-3xl font-semibold text-[#161615] mt-1 tabular-nums">
                        {uniqueBrandsCount}
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="font-mono text-[11px] uppercase tracking-wider text-[#6E6C65]">
                        Estado General
                      </div>
                      <div className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#157347]">
                        <CheckCircle2 className="w-4 h-4" />
                        Certificado por IA
                      </div>
                    </div>
                  </div>

                  {/* Certified Mentions List / Table */}
                  {auspiciadores.length === 0 ? (
                    <div className="border border-[#D8D6CE] bg-[#FAF9F6] p-8 text-center">
                      <p className="text-sm font-medium text-[#161615]">
                        No se detectaron menciones comerciales en esta
                        transmisión.
                      </p>
                      <p className="font-mono text-xs text-[#6E6C65] mt-1">
                        Puede enviar igualmente el acta de auditoría sin
                        hallazgos por WhatsApp.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="font-mono text-xs uppercase tracking-wider text-[#6E6C65]">
                        Acta de Menciones Certificadas ({auspiciadores.length})
                      </div>

                      <div className="divide-y divide-[#E6E4DC] border border-[#D8D6CE]">
                        {auspiciadores.map((item, index) => {
                          const cleanTs = item.timestamp
                            .replace(/[\[\]]/g, "")
                            .trim();
                          return (
                            <article
                              key={`${item.marca}-${item.timestamp}-${index}`}
                              className="p-4 sm:p-5 bg-white hover:bg-[#FAF9F6] transition"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                                <div className="flex flex-wrap items-center gap-2.5">
                                  <span className="font-mono text-xs px-2 py-0.5 bg-[#161615] text-[#F6F5F1] tabular-nums flex items-center gap-1">
                                    <Clock className="w-3 h-3" />[{cleanTs}]
                                  </span>
                                  <h3 className="text-base font-semibold text-[#161615]">
                                    {item.marca}
                                  </h3>
                                  <span className="font-mono text-[11px] px-2 py-0.5 border border-[#D8D6CE] bg-[#F6F5F1] text-[#4A4944]">
                                    {item.tipo}
                                  </span>
                                </div>

                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 border border-[#157347] bg-[#EBF5EE] text-[#157347] font-mono text-[11px] font-medium">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Certificado
                                </span>
                              </div>

                              <blockquote className="mt-2 pl-3 border-l-2 border-[#161615] text-xs sm:text-sm text-[#33322E] italic">
                                &ldquo;{item.cita}&rdquo;
                              </blockquote>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 3 Footer */}
            <div className="border-t border-[#E6E4DC] bg-[#FAF9F6] px-6 py-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={isDetecting}
                className="text-xs font-mono text-[#575650] hover:text-[#161615] underline underline-offset-4 disabled:opacity-40 cursor-pointer"
              >
                ← Ver transcripción
              </button>

              <button
                type="button"
                disabled={isDetecting || Boolean(detectError)}
                onClick={handleProceedToWhatsApp}
                className="px-6 py-2.5 bg-[#157347] text-white text-sm font-medium disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[#115C39] transition flex items-center gap-2 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>Enviar Reporte por WhatsApp (Siguiente)</span>
              </button>
            </div>
          </section>
        )}

        {/* STEP 4: ENVÍO POR WHATSAPP Y REINICIO */}
        {step === 4 && (
          <section className="border border-[#D8D6CE] bg-white">
            <div className="border-b border-[#E6E4DC] px-6 py-4 flex items-center justify-between bg-[#FAF9F6]">
              <div>
                <span className="font-mono text-[11px] uppercase tracking-widest text-[#6E6C65]">
                  Módulo 04 · Despacho Meta WhatsApp Cloud API (v25.0)
                </span>
                <h2 className="text-lg font-semibold text-[#161615]">
                  Confirmación de Envío de Reporte
                </h2>
              </div>
            </div>

            <div className="p-6 sm:p-8">
              {isSendingWhatsApp ? (
                <div className="py-16 flex flex-col items-center justify-center text-center">
                  <Loader2 className="w-7 h-7 animate-spin text-[#157347] mb-3" />
                  <p className="text-sm font-medium text-[#161615]">
                    Despachando reporte certificado vía WhatsApp Cloud API...
                  </p>
                  <p className="font-mono text-xs text-[#78766F] mt-1">
                    Endpoint: graph.facebook.com/v25.0
                  </p>
                </div>
              ) : whatsAppError ? (
                <div className="border border-[#E5B8B8] bg-[#FDF5F5] p-5">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-[#C81E1E] shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-semibold text-[#8A1C1C]">
                        Error al enviar reporte por WhatsApp
                      </h3>
                      <p className="text-xs text-[#8A1C1C] mt-1">
                        {whatsAppError}
                      </p>
                      <div className="mt-4 flex gap-3">
                        <button
                          type="button"
                          onClick={handleProceedToWhatsApp}
                          className="px-4 py-2 bg-[#161615] text-white text-xs font-mono uppercase cursor-pointer"
                        >
                          Reintentar envío
                        </button>
                        <button
                          type="button"
                          onClick={() => setStep(3)}
                          className="px-4 py-2 border border-[#161615] text-[#161615] text-xs font-mono uppercase cursor-pointer"
                        >
                          Volver al Dashboard
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : whatsAppResult ? (
                <div className="space-y-6">
                  {/* Visual Confirmation Banner */}
                  <div className="border border-[#157347] bg-[#EBF5EE] p-5 flex items-start gap-3.5">
                    <CheckCircle2 className="w-6 h-6 text-[#157347] shrink-0 mt-0.5" />
                    <div className="text-xs sm:text-sm">
                      <h3 className="font-semibold text-[#0F5233] text-base">
                        Reporte enviado a Meta WhatsApp Cloud API
                      </h3>
                      <p className="text-[#157347] mt-0.5">
                        El acta consolidada de menciones publicitarias fue
                        despachada desde el número de prueba{" "}
                        <strong className="font-mono">+1 555-163-0956</strong>.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-[#0F5233]">
                        <span>
                          Destinatario:{" "}
                          <strong>+{whatsAppResult.recipient}</strong>
                        </span>
                        {whatsAppResult.messageId && (
                          <span className="truncate max-w-xs sm:max-w-md">
                            ID: {whatsAppResult.messageId}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Meta Sandbox 24h Customer Service Window Helper */}
                  <div className="border border-[#D8D6CE] bg-[#FAF9F6] p-4 text-xs">
                    <div className="font-mono uppercase tracking-wider text-[#161615] font-semibold mb-1">
                      ¿No llegó el texto libre a tu teléfono? (Ventana de 24h de
                      Meta Sandbox)
                    </div>
                    <p className="text-[#575650] leading-relaxed">
                      Por política de Meta WhatsApp Cloud API, los mensajes de
                      texto libre (<code className="font-mono">type: text</code>
                      ) sólo se entregan si tu número{" "}
                      <strong className="font-mono">
                        +{whatsAppResult.recipient}
                      </strong>{" "}
                      le ha enviado o respondido un mensaje al número de prueba{" "}
                      <strong className="font-mono">+1 555-163-0956</strong> en
                      las últimas 24 horas. Si la ventana estaba cerrada, sigue
                      estos 2 pasos:
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={handleSendHelloTemplate}
                        disabled={isSendingTemplate}
                        className="px-3.5 py-2 border border-[#161615] bg-white text-[#161615] font-mono text-xs hover:bg-[#161615] hover:text-white transition cursor-pointer disabled:opacity-50"
                      >
                        {isSendingTemplate
                          ? "Enviando plantilla..."
                          : "1. Enviar plantilla hello_world (Abre chat)"}
                      </button>
                      <button
                        type="button"
                        onClick={handleProceedToWhatsApp}
                        disabled={isSendingWhatsApp}
                        className="px-3.5 py-2 bg-[#157347] text-white font-mono text-xs hover:bg-[#115C39] transition cursor-pointer disabled:opacity-50"
                      >
                        2. Reenviar Reporte de Texto Ahora
                      </button>
                    </div>
                    {templateStatus && (
                      <p className="mt-2.5 font-mono text-xs text-[#157347]">
                        {templateStatus}
                      </p>
                    )}
                  </div>

                  {/* Preview of Sent WhatsApp Message */}
                  <div>
                    <div className="font-mono text-xs uppercase tracking-wider text-[#6E6C65] mb-2">
                      Vista previa del mensaje despachado
                    </div>
                    <pre className="border border-[#D8D6CE] bg-[#FAF9F6] p-4 font-mono text-xs sm:text-sm leading-relaxed text-[#161615] whitespace-pre-wrap overflow-x-auto">
                      {whatsAppResult.messagePreview}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Step 4 Footer */}
            <div className="border-t border-[#E6E4DC] bg-[#FAF9F6] px-6 py-4 flex items-center justify-between">
              <span className="font-mono text-xs text-[#6E6C65]">
                Ciclo de certificación finalizado
              </span>

              <button
                type="button"
                onClick={handleReset}
                disabled={isSendingWhatsApp}
                className="px-6 py-2.5 bg-[#161615] text-[#F6F5F1] text-sm font-medium hover:bg-[#2E2E2B] transition flex items-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Nueva Grabación / Reiniciar</span>
              </button>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#DFDDD4] bg-[#EFECE6] py-3 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-[#6E6C65] gap-2">
          <span>ENLÍNEA RADIO · SISTEMA DE MONITOREO Y CERTIFICACIÓN DE PAUTA</span>
          <span>SIN PERSISTENCIA EN SERVIDOR · VERCEL SERVERLESS READY</span>
        </div>
      </footer>
    </div>
  );
}
