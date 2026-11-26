import { NextRequest, NextResponse } from "next/server";

export interface SponsorMention {
  marca: string;
  timestamp: string;
  tipo: "Mención en vivo" | "Frase comercial";
  cita: string;
}

const MAX_CHUNK_CHARS = 22000;

function splitTranscriptIntoChunks(
  transcript: string,
  maxChars: number = MAX_CHUNK_CHARS
): string[] {
  const cleaned = transcript.trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const lines = cleaned.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    if (line.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < line.length; i += maxChars) {
        chunks.push(line.slice(i, i + maxChars));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxChars) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function normalizeTimestamp(raw: unknown): string {
  if (typeof raw !== "string") return "00:00";
  const cleaned = raw.replace(/[\[\]]/g, "").trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    return `${match[1].padStart(2, "0")}:${match[2]}`;
  }
  return cleaned || "00:00";
}

function normalizeTipo(raw: unknown): "Mención en vivo" | "Frase comercial" {
  if (typeof raw === "string") {
    const lower = raw.toLowerCase();
    if (lower.includes("frase") || lower.includes("comercial") || lower.includes("spot")) {
      return "Frase comercial";
    }
  }
  return "Mención en vivo";
}

const SYSTEM_PROMPT = `Eres un auditor experto en monitoreo y certificación de pauta publicitaria en radio chilena.
Analiza la transcripción con marcas de tiempo ([MM:SS]) y extrae TODAS las menciones publicitarias de marcas comerciales, empresas anunciantes, productos o auspiciadores.

Reglas estrictas:
1. Devuelve ÚNICAMENTE un objeto JSON válido con la propiedad "auspiciadores".
2. Cada elemento de "auspiciadores" debe tener exactamente esta estructura:
{
  "auspiciadores": [
    {
      "marca": "Nombre de la marca",
      "timestamp": "MM:SS",
      "tipo": "Mención en vivo | Frase comercial",
      "cita": "Cita textual exacta donde se menciona"
    }
  ]
}
3. El campo "timestamp" debe corresponder a la marca de tiempo MM:SS (sin corchetes) donde aparece la mención en la transcripción.
4. El campo "tipo" debe ser:
   - "Mención en vivo": cuando el locutor menciona, recomienda o comenta orgánicamente al auspiciador dentro de la conducción del programa.
   - "Frase comercial": cuando se lee un eslogan directo, llamado a la acción publicitario, promoción o frase comercial estructurada.
5. El campo "cita" debe contener la cita textual exacta extraída de la transcripción que sirve como respaldo probatorio.
6. No incluyas el nombre de la propia emisora de radio salvo que sea explícitamente presentada como un patrocinador comercial externo.
7. Si no existen menciones de marcas o auspiciadores reales en el texto, devuelve {"auspiciadores": []}.`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY no está configurada en el servidor." },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.transcript !== "string") {
      return NextResponse.json(
        { error: "Se requiere el campo 'transcript' (string) en el cuerpo JSON." },
        { status: 400 }
      );
    }

    const transcript = body.transcript.trim();
    if (!transcript) {
      return NextResponse.json({ auspiciadores: [] });
    }

    const pautaMessage =
      typeof body.pautaMessage === "string" ? body.pautaMessage.trim() : "";

    const chunks = splitTranscriptIntoChunks(transcript, MAX_CHUNK_CHARS);
    const allMentions: SponsorMention[] = [];

    for (const chunk of chunks) {
      const userPrompt = pautaMessage
        ? `MENSAJE DE PAUTA / AUSPICIADORES DE REFERENCIA:\n${pautaMessage}\n\nExtrae los auspiciadores que efectivamente fueron mencionados y sus citas textuales de la siguiente transcripción radial:\n\n${chunk}`
        : `Extrae los auspiciadores y citas textuales de la siguiente transcripción radial:\n\n${chunk}`;

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
                content: SYSTEM_PROMPT,
              },
              {
                role: "user",
                content: userPrompt,
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          {
            error: `Error en Groq LLM API (${response.status})`,
            details: errorText,
          },
          { status: response.status }
        );
      }

      const data = await response.json();
      const rawContent = data?.choices?.[0]?.message?.content;

      if (typeof rawContent === "string" && rawContent.trim()) {
        try {
          const parsed = JSON.parse(rawContent);
          const list = Array.isArray(parsed?.auspiciadores)
            ? parsed.auspiciadores
            : [];

          for (const item of list) {
            if (
              item &&
              typeof item.marca === "string" &&
              item.marca.trim() &&
              typeof item.cita === "string" &&
              item.cita.trim()
            ) {
              allMentions.push({
                marca: item.marca.trim(),
                timestamp: normalizeTimestamp(item.timestamp),
                tipo: normalizeTipo(item.tipo),
                cita: item.cita.trim(),
              });
            }
          }
        } catch {
          // Ignore malformed chunk JSON if any, continue safely
        }
      }
    }

    return NextResponse.json({
      auspiciadores: allMentions,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error interno al detectar auspiciadores.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
