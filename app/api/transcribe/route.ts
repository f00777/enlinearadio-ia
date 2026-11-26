import { NextRequest, NextResponse } from "next/server";

const MAX_FILE_SIZE_BYTES = Math.floor(4.5 * 1024 * 1024); // 4.5 MB Vercel limit

interface Segment {
  start: number;
  text: string;
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function refineSegmentsWithPauta(
  segments: Segment[],
  pautaMessage: string,
  apiKey: string
): Promise<Segment[]> {
  const trimmedPauta = pautaMessage.trim();
  if (!trimmedPauta || segments.length === 0) {
    return segments;
  }

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `Eres un corrector fonético experto en transcripciones de radio en Chile.
Recibirás:
1. El MENSAJE DE PAUTA enviado por el jefe de locutores con la lista de auspiciadores, marcas (en español o inglés, ej. "Yankee Candle", "Banco de Chile") o frases que el locutor debía mencionar.
2. Los SEGMENTOS CRUDOS transcritos por Whisper desde el audio.

Tu tarea:
- Revisar cada segmento y corregir palabras mal transcritas por pronunciación, omisión de letras o fonética en otro idioma cuando claramente correspondan a una marca, término o palabra presente en el MENSAJE DE PAUTA (por ejemplo: si el audio dice "sile" y el contexto/pauta es "Chile", cámbialo a "Chile"; si dice "llanqui candol" o "yanki candle" y la pauta incluye "Yankee Candle", cámbialo a "Yankee Candle").
- NO inventes ni agregues auspiciadores que no se hayan pronunciado en el audio; sólo corrige lo que fonéticamente o por contexto fue dicho en cada segmento.
- Mantén exactamente la misma cantidad de segmentos y sus valores numéricos "start" intactos.
- Devuelve ESTRICTAMENTE un objeto JSON con este formato:
{
  "segments": [
    { "start": 0, "text": "Texto corregido..." }
  ]
}`,
            },
            {
              role: "user",
              content: `MENSAJE DE PAUTA / AUSPICIADORES DEL JEFE DE LOCUTORES:\n${trimmedPauta}\n\nSEGMENTOS TRANSCRITOS DEL AUDIO:\n${JSON.stringify(
                segments
              )}`,
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      return segments;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return segments;
    }

    const parsed = JSON.parse(content);
    if (
      !Array.isArray(parsed?.segments) ||
      parsed.segments.length !== segments.length
    ) {
      return segments;
    }

    return segments.map((orig, idx) => {
      const candidate = parsed.segments[idx];
      const correctedText =
        candidate &&
        typeof candidate.text === "string" &&
        candidate.text.trim()
          ? candidate.text.trim()
          : orig.text;
      return {
        start: orig.start,
        text: correctedText,
      };
    });
  } catch {
    return segments;
  }
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY no está configurada en el servidor." },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const pautaMessageField = formData.get("pautaMessage");
    const pautaMessage =
      typeof pautaMessageField === "string" ? pautaMessageField.trim() : "";

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No se recibió un archivo de audio válido en el campo 'file'." },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "El archivo de audio está vacío." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `El archivo excede el límite permitido de 4.5 MB (${(
            file.size /
            (1024 * 1024)
          ).toFixed(2)} MB).`,
        },
        { status: 413 }
      );
    }

    const originalName =
      "name" in file && typeof file.name === "string" && file.name
        ? file.name
        : "grabacion.webm";

    // Build Whisper prompt (Whisper supports ~224 tokens in prompt)
    const basePrompt =
      "Transmisión de radio en Chile. Menciones comerciales, marcas y auspiciadores.";
    const whisperPrompt = pautaMessage
      ? `${basePrompt} Pauta de auspiciadores: ${pautaMessage.slice(0, 650)}`
      : basePrompt;

    const groqForm = new FormData();
    groqForm.append("file", file, originalName);
    groqForm.append("model", "whisper-large-v3");
    groqForm.append("language", "es");
    groqForm.append("response_format", "verbose_json");
    groqForm.append("prompt", whisperPrompt);

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: groqForm,
      }
    );

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      return NextResponse.json(
        {
          error: `Error en Groq Whisper API (${groqResponse.status})`,
          details: errorText,
        },
        { status: groqResponse.status }
      );
    }

    const data = await groqResponse.json();

    const rawSegments: Array<{ start?: number; text?: string }> = Array.isArray(
      data.segments
    )
      ? data.segments
      : [];

    let segments: Segment[] = rawSegments
      .map((seg) => ({
        start: typeof seg.start === "number" ? seg.start : 0,
        text: (seg.text ?? "").trim(),
      }))
      .filter((seg) => seg.text.length > 0);

    if (
      segments.length === 0 &&
      typeof data.text === "string" &&
      data.text.trim()
    ) {
      segments = [{ start: 0, text: data.text.trim() }];
    }

    // If the user pasted a pauta/sponsors message, refine phonetic misrecognitions against it
    if (pautaMessage && segments.length > 0) {
      segments = await refineSegmentsWithPauta(segments, pautaMessage, apiKey);
    }

    const formattedText = segments
      .map((seg) => `[${formatTimestamp(seg.start)}] ${seg.text}`)
      .join("\n");

    return NextResponse.json({
      segments,
      formattedText,
      pautaApplied: Boolean(pautaMessage),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error interno al transcribir audio.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
