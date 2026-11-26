import { NextRequest, NextResponse } from "next/server";

interface SponsorItem {
  marca: string;
  timestamp: string;
  tipo: string;
  cita: string;
}

function buildWhatsAppReport(auspiciadores: SponsorItem[]): string {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Santiago",
  }).format(now);

  const uniqueBrands = new Set(
    auspiciadores.map((a) => a.marca.trim().toLowerCase()).filter(Boolean)
  ).size;

  const lines: string[] = [
    "*REPORTE DE CERTIFICACIÓN PUBLICITARIA*",
    "EnLínea Radio — Auditoría Automatizada",
    `Fecha: ${dateStr}`,
    "────────────────────",
    `• Total menciones: *${auspiciadores.length}*`,
    `• Marcas únicas: *${uniqueBrands}*`,
    "• Estado: *Certificado por IA*",
    "────────────────────",
  ];

  if (auspiciadores.length === 0) {
    lines.push("No se registraron menciones comerciales en el bloque auditado.");
  } else {
    auspiciadores.forEach((item, idx) => {
      const ts = item.timestamp.replace(/[\[\]]/g, "").trim() || "00:00";
      lines.push(
        `${idx + 1}. *${item.marca}* [${ts}] — _${item.tipo}_`,
        `   "${item.cita}"`
      );
    });
  }

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const defaultRecipient = process.env.WHATSAPP_TEST_RECIPIENT;

    if (!token || !phoneId) {
      return NextResponse.json(
        {
          error:
            "Credenciales de WhatsApp (WHATSAPP_TOKEN o WHATSAPP_PHONE_ID) no configuradas.",
        },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "Cuerpo JSON inválido." },
        { status: 400 }
      );
    }

    const recipient =
      (typeof body.to === "string" && body.to.trim()) ||
      defaultRecipient ||
      "";

    if (!recipient) {
      return NextResponse.json(
        {
          error:
            "No se encontró número destinatario (WHATSAPP_TEST_RECIPIENT).",
        },
        { status: 400 }
      );
    }

    const graphUrl = `https://graph.facebook.com/v25.0/${phoneId}/messages`;

    // Mode 1: Send pre-approved hello_world template to open/initiate the 24h window
    if (body.mode === "template_hello") {
      const tplResponse = await fetch(graphUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: "hello_world",
            language: { code: "en_US" },
          },
        }),
      });

      const tplData = await tplResponse.json().catch(() => ({}));
      if (!tplResponse.ok) {
        return NextResponse.json(
          {
            error:
              tplData?.error?.message ||
              `Error al enviar plantilla (${tplResponse.status})`,
            details: tplData,
          },
          { status: tplResponse.status }
        );
      }

      return NextResponse.json({
        success: true,
        mode: "template_hello",
        recipient,
        messageId: tplData?.messages?.[0]?.id ?? null,
        messageStatus: tplData?.messages?.[0]?.message_status ?? "accepted",
        whatsappResponse: tplData,
      });
    }

    // Mode 2 (Default): Send free-form text report
    if (!Array.isArray(body.auspiciadores)) {
      return NextResponse.json(
        { error: "Se requiere el arreglo 'auspiciadores' en el cuerpo JSON." },
        { status: 400 }
      );
    }

    const auspiciadores: SponsorItem[] = body.auspiciadores.map(
      (item: Partial<SponsorItem>) => ({
        marca: typeof item?.marca === "string" ? item.marca.trim() : "Marca",
        timestamp:
          typeof item?.timestamp === "string" ? item.timestamp.trim() : "00:00",
        tipo:
          typeof item?.tipo === "string"
            ? item.tipo.trim()
            : "Mención en vivo",
        cita: typeof item?.cita === "string" ? item.cita.trim() : "",
      })
    );

    const messageText = buildWhatsAppReport(auspiciadores);

    const waResponse = await fetch(graphUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: {
          body: messageText,
        },
      }),
    });

    const waData = await waResponse.json().catch(() => ({}));

    if (!waResponse.ok) {
      return NextResponse.json(
        {
          error:
            waData?.error?.message ||
            `Error en Meta WhatsApp Cloud API (${waResponse.status})`,
          details: waData,
          messagePreview: messageText,
          recipient,
        },
        { status: waResponse.status }
      );
    }

    return NextResponse.json({
      success: true,
      mode: "text",
      recipient,
      messageId: waData?.messages?.[0]?.id ?? null,
      messagePreview: messageText,
      whatsappResponse: waData,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error interno al enviar reporte por WhatsApp.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
