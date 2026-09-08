import os
import io
import re
import smtplib
from datetime import datetime
from dotenv import load_dotenv

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

from flask import Blueprint, request, jsonify, send_file
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle)
from reportlab.lib.enums import TA_LEFT

documents_bp = Blueprint("documents", __name__)
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# ==================== HERMES REPORT DESIGN ====================
# Presentation-only redesign. Routes, request payloads, IOC extraction,
# MITRE data, investigation steps, and email behaviour remain unchanged.

INK = colors.HexColor("#0B1220")
MUTED = colors.HexColor("#667085")
SUBTLE = colors.HexColor("#98A2B3")
RULE = colors.HexColor("#E4E7EC")
PANEL = colors.HexColor("#F8FAFC")
PANEL_BLUE = colors.HexColor("#EFF6FF")
BLUE = colors.HexColor("#2563EB")
INDIGO = colors.HexColor("#6366F1")
DARK = colors.HexColor("#0B1220")
WHITE = colors.white

SEVERITY_COLOURS = {
    "CRITICAL": colors.HexColor("#DC2626"),
    "HIGH": colors.HexColor("#EA580C"),
    "MEDIUM": colors.HexColor("#D97706"),
    "LOW": colors.HexColor("#16A34A"),
}

SECTION_NAMES = [
    "SUMMARY", "OVERVIEW", "THREAT DETAILS", "TOP THREATS", "PATTERNS DETECTED",
    "WHAT THIS MEANS", "ENDPOINT SECURITY", "RISK LEVEL", "RISK ASSESSMENT",
    "CVE IMPACT", "SITUATION", "RECOMMENDED ACTIONS", "PRIORITY ACTIONS",
    "IMMEDIATE ACTIONS",
]

ACTION_SECTIONS = {"RECOMMENDED ACTIONS", "PRIORITY ACTIONS", "IMMEDIATE ACTIONS"}

_styles = getSampleStyleSheet()
ST = {
    "title": ParagraphStyle("hero_title", parent=_styles["Title"],
                             fontName="Helvetica-Bold", fontSize=25,
                             leading=29, textColor=INK, spaceAfter=3),
    "eyebrow": ParagraphStyle("eyebrow", parent=_styles["Normal"],
                              fontName="Helvetica-Bold", fontSize=7,
                              leading=9, textColor=BLUE, tracking=0.7),
    "sub": ParagraphStyle("sub", parent=_styles["Normal"],
                          fontName="Helvetica", fontSize=8.5,
                          leading=12, textColor=MUTED),
    "h": ParagraphStyle("section", parent=_styles["Heading2"],
                        fontName="Helvetica-Bold", fontSize=11,
                        leading=14, textColor=INK, spaceBefore=12,
                        spaceAfter=7),
    "body": ParagraphStyle("body", parent=_styles["Normal"],
                           fontName="Helvetica", fontSize=9.2,
                           leading=14.2, textColor=INK, spaceAfter=7),
    "small": ParagraphStyle("small", parent=_styles["Normal"],
                            fontName="Helvetica", fontSize=7.4,
                            leading=10, textColor=MUTED),
    "cell": ParagraphStyle("cell", parent=_styles["Normal"],
                           fontName="Helvetica", fontSize=7.8,
                           leading=10.5, textColor=INK),
    "cellh": ParagraphStyle("cellh", parent=_styles["Normal"],
                            fontName="Helvetica-Bold", fontSize=6.8,
                            leading=8.5, textColor=WHITE),
    "metric": ParagraphStyle("metric", parent=_styles["Normal"],
                             fontName="Helvetica-Bold", fontSize=13,
                             leading=15, textColor=INK),
    "metric_label": ParagraphStyle("metric_label", parent=_styles["Normal"],
                                   fontName="Helvetica-Bold", fontSize=6.3,
                                   leading=8, textColor=MUTED),
    "mono": ParagraphStyle("mono", parent=_styles["Normal"],
                           fontName="Courier", fontSize=7.5,
                           leading=10, textColor=INK),
}

def _esc(text):
    return (str(text).replace("&", "&amp;")
                     .replace("<", "&lt;")
                     .replace(">", "&gt;"))

def _parse_sections(text):
    found = [(n, text.find(n)) for n in SECTION_NAMES if text.find(n) != -1]
    if not found:
        return [(None, text.strip())]
    found.sort(key=lambda x: x[1])
    out = []
    preamble = text[:found[0][1]].strip()
    if preamble:
        out.append((None, preamble))
    for i, (name, idx) in enumerate(found):
        start = idx + len(name)
        end = found[i + 1][1] if i + 1 < len(found) else len(text)
        body = re.sub(r"^[\s:\-]+", "", text[start:end]).strip()
        if body:
            out.append((name, body))
    return out

def _extract_iocs(text):
    ips = [ip for ip in dict.fromkeys(
        re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", text)
    ) if all(int(o) < 256 for o in ip.split("."))]
    sigs = list(dict.fromkeys(re.findall(r"ET [A-Z]+ [^\n,.]{5,60}", text)))
    ports = list(dict.fromkeys(re.findall(r"\bport[:\s]+(\d{1,5})\b", text, re.I)))
    cves = list(dict.fromkeys(re.findall(r"CVE-\d{4}-\d{4,7}", text)))
    return ips, sigs, ports, cves

def _severity_of(text):
    m = re.search(r"(?:RISK LEVEL|RISK ASSESSMENT)[:\s]*\n?\s*\[?\s*"
                  r"(CRITICAL|HIGH|MEDIUM|LOW)", text, re.I)
    return m.group(1).upper() if m else None

def _case_id(title, content):
    h = abs(hash(f"{title}|{content[:200]}")) % 10000
    return f"SIRA-{datetime.utcnow().year}-{h:04d}"

def _safe_filename(title):
    base = re.sub(r"[^A-Za-z0-9 _-]", "", title)[:50].strip().replace(" ", "_")
    return f"{base or 'SIRA_report'}.pdf"

def _table(rows, widths, zebra=True):
    data = [[Paragraph(_esc(c), ST["cellh"]) for c in rows[0]]]
    data += [[Paragraph(c, ST["cell"]) for c in r] for r in rows[1:]]
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("TOPPADDING", (0, 1), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -1), 0.45, RULE),
        ("LINEABOVE", (0, 0), (-1, 0), 1.3, BLUE),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
    ]
    if zebra:
        style.append(("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PANEL]))
    t.setStyle(TableStyle(style))
    return t

def _card(flowables, width, background=WHITE, border=RULE, accent=None):
    t = Table([[flowables]], colWidths=[width])
    style = [
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("BOX", (0, 0), (-1, -1), 0.65, border),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]
    if accent:
        style.append(("LINEBEFORE", (0, 0), (0, 0), 3, accent))
    t.setStyle(TableStyle(style))
    return t

def _section_label(number, title):
    return Paragraph(
        f'<font color="#2563EB"><b>{number:02d}</b></font>  '
        f'<font color="#0B1220"><b>{_esc(title.upper())}</b></font>',
        ST["h"]
    )

def _furniture(canvas, doc):
    """Minimal premium Hermes page shell."""
    canvas.saveState()
    w, h = A4

    # Thin top identity bar.
    canvas.setFillColor(DARK)
    canvas.rect(0, h - 12 * mm, w, 12 * mm, stroke=0, fill=1)
    canvas.setFillColor(BLUE)
    canvas.rect(0, h - 12 * mm, w, 1.2 * mm, stroke=0, fill=1)

    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 8.5)
    canvas.drawString(17 * mm, h - 7.7 * mm, "HERMES")
    canvas.setFont("Helvetica", 6.2)
    canvas.drawString(34 * mm, h - 7.7 * mm, "SECURITY INTELLIGENCE")

    canvas.setFont("Helvetica-Bold", 6.2)
    canvas.drawRightString(w - 17 * mm, h - 7.7 * mm, "CONFIDENTIAL")

    # Footer.
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(17 * mm, 13 * mm, w - 17 * mm, 13 * mm)
    canvas.setFillColor(SUBTLE)
    canvas.setFont("Helvetica", 6.4)
    canvas.drawString(17 * mm, 8 * mm,
                      "Hermes automated analysis  ·  Verify findings before acting")
    canvas.setFont("Helvetica-Bold", 6.4)
    canvas.drawRightString(w - 17 * mm, 8 * mm, f"{doc.page:02d}")
    canvas.restoreState()

def _build_pdf(title, content, meta_lines=None, source_query="", analyst=None,
               model=None, steps=None, mitre=None):
    """Build a premium Hermes security intelligence report."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=20 * mm, bottomMargin=20 * mm,
        leftMargin=17 * mm, rightMargin=17 * mm,
        title=title, author="Hermes",
    )
    W = A4[0] - 34 * mm

    sections = _parse_sections(content)
    ips, sigs, ports, cves = _extract_iocs(content)
    severity = _severity_of(content)
    story = []

    # ==================== COVER / EXECUTIVE HERO ====================
    sev_color = SEVERITY_COLOURS.get(severity, BLUE)
    sev_label = severity or "ASSESSMENT"

    hero_left = [
        Paragraph("SECURITY INVESTIGATION", ST["eyebrow"]),
        Spacer(1, 2),
        Paragraph(_esc(title), ST["title"]),
        Paragraph("Automated security intelligence report generated by Hermes.", ST["sub"]),
    ]

    sev_box = Table([[
        Paragraph(f'<font size="7"><b>RISK</b></font><br/>'
                  f'<font size="15"><b>{_esc(sev_label)}</b></font>',
                  ParagraphStyle("sev", parent=ST["cell"],
                                 textColor=WHITE, leading=18))
    ]], colWidths=[31 * mm], rowHeights=[24 * mm])
    sev_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), sev_color),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))

    hero = Table([[hero_left, sev_box]], colWidths=[W - 35 * mm, 31 * mm])
    hero.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.8, RULE),
        ("LINEBEFORE", (0, 0), (0, 0), 4, BLUE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 13),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 13),
    ]))
    story.append(hero)
    story.append(Spacer(1, 7))

    # ==================== METADATA RAIL ====================
    case_id = _case_id(title, content)
    telemetry = Table([
        [Paragraph("CASE", ST["metric_label"]),
         Paragraph("GENERATED", ST["metric_label"]),
         Paragraph("ANALYST", ST["metric_label"]),
         Paragraph("MODEL", ST["metric_label"])],
        [Paragraph(case_id, ST["metric"]),
         Paragraph(datetime.utcnow().strftime("%d %b %Y"), ST["cell"]),
         Paragraph(_esc(analyst or "Hermes AI"), ST["cell"]),
         Paragraph(_esc(model or "—"), ST["cell"])]
    ], colWidths=[W*.25, W*.25, W*.25, W*.25])
    telemetry.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("BOX", (0, 0), (-1, -1), 0.65, RULE),
        ("LINEBEFORE", (0, 0), (0, -1), 3, INDIGO),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, 0), 5),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ("TOPPADDING", (0, 1), (-1, 1), 1),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 7),
    ]))
    story.append(telemetry)

    if source_query:
        story.append(Spacer(1, 6))
        story.append(Paragraph(
            f'<b>ORIGINATING QUERY</b>  <font color="#667085"><i>{_esc(source_query)}</i></font>',
            ST["small"]))

    for line in (meta_lines or []):
        story.append(Paragraph(_esc(line), ST["small"]))

    # ==================== KEY SIGNALS ====================
    counts = [
        ("INDICATORS", len(ips) + len(sigs) + len(ports) + len(cves)),
        ("MITRE", len(mitre or [])),
        ("STEPS", len(steps or [])),
        ("CVEs", len(cves)),
    ]
    metric_data = [[
        Paragraph(str(v), ST["metric"]) for _, v in counts
    ], [
        Paragraph(k, ST["metric_label"]) for k, _ in counts
    ]]
    metric_card = Table(metric_data, colWidths=[W/4]*4)
    metric_card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL_BLUE),
        ("BOX", (0, 0), (-1, -1), 0.65, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
        ("TOPPADDING", (0, 1), (-1, 1), 1),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 7),
    ]))
    story.append(Spacer(1, 6))
    story.append(metric_card)

    # ==================== EXECUTIVE BRIEF ====================
    summary_body = next(
        (b for n, b in sections if n in {"SUMMARY", "OVERVIEW", "WHAT THIS MEANS", "SITUATION"}),
        None
    )
    if summary_body:
        story.append(_section_label(1, "Executive Brief"))
        story.append(_card(
            [Paragraph("WHAT HAPPENED", ST["eyebrow"])] +
            [Paragraph(_esc(p).replace("\n", "<br/>"), ST["body"])
             for p in summary_body.split("\n\n")[:3]],
            W, background=WHITE, accent=BLUE
        ))

    # ==================== IOCs ====================
    if ips or sigs or ports or cves:
        story.append(_section_label(2, "Indicators of Compromise"))
        rows = [["TYPE", "INDICATOR", "CONTEXT"]]
        rows += [["IP ADDRESS", f'<font face="Courier">{ip}</font>',
                  "Observed in alert traffic"] for ip in ips[:8]]
        rows += [["SIGNATURE", _esc(s), "Suricata detection"] for s in sigs[:5]]
        rows += [["PORT", f'<font face="Courier">{p}</font>',
                  "Targeted service port"] for p in ports[:5]]
        rows += [["CVE", f'<font face="Courier">{c}</font>',
                  "Correlated vulnerability"] for c in cves[:5]]
        story.append(_table(rows, [W*.18, W*.37, W*.45]))

    # ==================== MITRE ====================
    if mitre:
        story.append(_section_label(3, "MITRE ATT&CK Mapping"))
        rows = [["TACTIC", "TECHNIQUE", "ID"]]
        rows += [[_esc(m.get("tactic", "—")),
                  _esc(m.get("technique", "—")),
                  f'<font face="Courier"><b>{_esc(m.get("id", "—"))}</b></font>']
                 for m in mitre[:10]]
        story.append(_table(rows, [W*.28, W*.52, W*.20]))

    # ==================== DETAILED FINDINGS ====================
    detail_num = 4
    skip_names = {
        "SUMMARY", "OVERVIEW", "WHAT THIS MEANS", "SITUATION",
        "RECOMMENDED ACTIONS", "PRIORITY ACTIONS", "IMMEDIATE ACTIONS"
    }
    for name, body in sections:
        if name in skip_names:
            continue
        story.append(_section_label(detail_num, name or "Detailed Findings"))
        detail_num += 1
        for para in body.split("\n\n"):
            story.append(Paragraph(_esc(para).replace("\n", "<br/>"), ST["body"]))

    # ==================== INVESTIGATION TRAIL ====================
    if steps:
        story.append(_section_label(detail_num, "Investigation Trail"))
        story.append(Paragraph(
            "Ordered evidence trail showing the checks performed by the agent.",
            ST["small"]
        ))
        story.append(Spacer(1, 4))
        trail = []
        for i, s in enumerate(steps[:15], 1):
            label = _esc(s.get("tool", "") or "Investigation step")
            result = str(s.get("result", ""))
            trail.append([
                Paragraph(f'<font color="#2563EB"><b>{i:02d}</b></font>', ST["cell"]),
                Paragraph(f'<b>{label}</b><br/><font color="#667085">'
                          f'{_esc(s.get("input") or "No input recorded")}</font>', ST["cell"]),
                Paragraph(_esc(result[:240] + ("…" if len(result) > 240 else "")), ST["cell"])
            ])
        t = Table(trail, colWidths=[W*.09, W*.28, W*.63])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), WHITE),
            ("BOX", (0, 0), (-1, -1), 0.6, RULE),
            ("LINEBELOW", (0, 0), (-1, -1), 0.45, RULE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(t)

    # ==================== RESPONSE PLAN ====================
    actions = next((b for n, b in sections if n in ACTION_SECTIONS), None)
    if actions:
        story.append(_section_label(detail_num + 1, "Response Plan"))
        items = [l.strip() for l in actions.split("\n") if re.match(r"^\d+\.", l.strip())]
        if not items:
            items = [l.strip() for l in actions.split("\n") if l.strip()]
        labels = ["NOW", "24 HOURS", "FOLLOW-UP", "FOLLOW-UP", "FOLLOW-UP"]
        action_rows = []
        for i, item in enumerate(items[:5]):
            action_rows.append([
                Paragraph(f'<font color="#2563EB"><b>{labels[min(i, 4)]}</b></font>', ST["cell"]),
                Paragraph(f'<b>{_esc(re.sub(r"^\d+\.\s*", "", item))}</b>', ST["cell"])
            ])
        action_table = Table(action_rows, colWidths=[W*.22, W*.78])
        action_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), WHITE),
            ("BOX", (0, 0), (-1, -1), 0.7, RULE),
            ("LINEBELOW", (0, 0), (-1, -1), 0.45, RULE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]))
        story.append(action_table)

    # Final assessment strip.
    story.append(Spacer(1, 8))
    final_text = {
        "CRITICAL": "Immediate investigation and containment recommended.",
        "HIGH": "Prompt investigation and remediation recommended.",
        "MEDIUM": "Further validation and targeted remediation recommended.",
        "LOW": "Continue monitoring and validate findings."
    }.get(severity, "Review findings and validate before taking action.")
    assessment = Table([[
        Paragraph(f'<font size="7"><b>HERMES ASSESSMENT</b></font><br/>'
                  f'<font size="13"><b>{_esc(sev_label)}</b></font><br/>'
                  f'<font size="8">{_esc(final_text)}</font>',
                  ParagraphStyle("final", parent=ST["cell"],
                                 textColor=WHITE, leading=15))
    ]], colWidths=[W])
    assessment.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DARK),
        ("LINEBEFORE", (0, 0), (0, 0), 4, sev_color),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 11),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
    ]))
    story.append(assessment)

    doc.build(story, onFirstPage=_furniture, onLaterPages=_furniture)
    buf.seek(0)
    return buf


def _pdf_from_request(data):
    """Shared between the PDF and email routes so both produce the same report."""
    title = (data.get("title") or "Untitled Document").strip()
    content = (data.get("content") or "").strip()
    source_query = data.get("source_query", "")

    meta_lines = []
    return title, content, _build_pdf(
        title, content,
        meta_lines=meta_lines,
        source_query=source_query,
        analyst=data.get("analyst"),
        model=data.get("model"),
        steps=data.get("steps"),
        mitre=data.get("mitre"),
    )


@documents_bp.route("/pdf", methods=["POST"])
def export_pdf():
    """
    Body: { "title": str, "content": str, "source_query": str (optional),
            "analyst": str (optional), "model": str (optional),
            "steps": [ {step, tool, input, result} ] (optional),
            "mitre": [ {tactic, technique, id} ] (optional) }
    """
    data = request.get_json(force=True) or {}

    if not (data.get("content") or "").strip():
        return jsonify({"error": "content is required"}), 400

    try:
        title, _, pdf_buf = _pdf_from_request(data)
    except Exception as e:
        return jsonify({"error": f"Could not build the report: {e}"}), 500

    return send_file(pdf_buf, mimetype="application/pdf",
                     as_attachment=True, download_name=_safe_filename(title))


@documents_bp.route("/email", methods=["POST"])
def email_document():
    """
    Body: { "title": str, "content": str, "source_query": str (optional),
            "to": "recipient@example.com", "message": "optional note" }
    """
    data = request.get_json(force=True) or {}
    to_email = (data.get("to") or "").strip()

    if not (data.get("content") or "").strip():
        return jsonify({"error": "content is required"}), 400
    if not to_email:
        return jsonify({"error": "Recipient email ('to') is required"}), 400

    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", 587))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    from_email = os.environ.get("SMTP_FROM", smtp_user)

    if not all([smtp_host, smtp_user, smtp_pass]):
        return jsonify({"error": "Email is not configured on the server (missing SMTP env vars)"}), 500

    try:
        title, _, pdf_buf = _pdf_from_request(data)
    except Exception as e:
        return jsonify({"error": f"Could not build the report: {e}"}), 500

    note = data.get("message", "")
    msg = MIMEMultipart()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = f"SIRA \u2014 {title}"
    msg.attach(MIMEText(
        note or f"Attached: SIRA investigation report '{title}'.", "plain"))

    attachment = MIMEBase("application", "pdf")
    attachment.set_payload(pdf_buf.read())
    encoders.encode_base64(attachment)
    attachment.add_header("Content-Disposition",
                          f"attachment; filename={_safe_filename(title)}")
    msg.attach(attachment)

    try:
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_email, to_email, msg.as_string())
        server.quit()
    except Exception as e:
        return jsonify({"error": f"Failed to send email: {e}"}), 500

    return jsonify({"message": f"Document emailed to {to_email}"})